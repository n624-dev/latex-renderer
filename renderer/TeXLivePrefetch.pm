package TeXLivePrefetch;
use strict;
use warnings;
use Digest::SHA ();
use File::Temp ();
use IO::Handle ();
use IO::Select ();
use JSON::PP qw(encode_json decode_json);
use POSIX ();
use Socket qw(AF_UNIX SOCK_STREAM PF_UNSPEC);
use Time::HiRes qw(time);
use TeXLive::TLUtils ();

# Preload before install-tl imports TLUtils. The signed installer and its
# unpack/checksum routines remain unmodified. Only its resolved NET install
# list and archive downloader are intercepted; metadata uses the original path.
my $original_install = \&TeXLive::TLUtils::install_packages;
my $original_download = \&TeXLive::TLUtils::download_file;
my $pool;

sub setting {
    my ($name, $default, $min, $max) = @_;
    my $value = $ENV{$name} // $default;
    die "Invalid $name\n" unless $value =~ /\A[0-9]+\z/ && $value >= $min && $value <= $max;
    return 0 + $value;
}

sub new {
    my ($class, $plan) = @_;
    my $count = setting('TEXLIVE_PREFETCH_WORKERS', 4, 1, 8);
    my $budget = setting('TEXLIVE_PREFETCH_BYTES', 268435456, 1, 1073741824);
    my $window = setting('TEXLIVE_PREFETCH_WINDOW', 16, 1, 64);
    my $dir = File::Temp->newdir('texlive-prefetch-XXXXXXXX', TMPDIR => 1);
    my $self = bless {plan => $plan, dir => $dir, budget => $budget,
        window => $window, reserved => 0, peak => 0, workers => [],
        tasks => {}, index => {}, wait => 0, transferred => 0}, $class;
    $self->{started} = time;
    $self->{cpu_start} = [times];
    for my $i (0 .. $#$plan) { $self->{index}{$plan->[$i]{url}} = $i; }
    for (1 .. $count) {
        socketpair(my $parent, my $child, AF_UNIX, SOCK_STREAM, PF_UNSPEC)
            or die "prefetch socketpair failed\n";
        $parent->autoflush(1);
        $child->autoflush(1);
        my $pid = fork();
        die "prefetch fork failed\n" unless defined $pid;
        if (!$pid) {
            close $parent;
            close $_->{socket} for @{$self->{workers}};
            $SIG{TERM} = $SIG{INT} = $SIG{PIPE} = 'DEFAULT';
            eval { worker($child) };
            POSIX::_exit($@ ? 1 : 0); # Never run inherited installer END hooks.
        }
        close $child;
        push @{$self->{workers}}, {pid => $pid, socket => $parent};
    }
    return $self;
}

sub worker {
    my ($socket) = @_;
    require LWP::UserAgent;
    require LWP::Protocol::https;
    my $ua = LWP::UserAgent->new(agent => 'texlive/lwp', timeout => 60, keep_alive => 1,
        max_redirect => 0, protocols_allowed => ['https']);
    while (my $line = <$socket>) {
        my $task = decode_json($line);
        my $ok = 0;
        for (1 .. 2) {
            my $file = "$task->{file}.part";
            eval {
                local $SIG{ALRM} = sub { die "download deadline\n" };
                alarm 120;
                open my $out, '>', $file or die "open failed\n";
                binmode $out;
                my $bytes = 0;
                my $sha = Digest::SHA->new(512);
                my $response = $ua->get($task->{url}, ':content_cb' => sub {
                    my ($chunk) = @_;
                    $bytes += length $chunk;
                    die "size exceeded\n" if $bytes > $task->{size};
                    print {$out} $chunk or die "write failed\n";
                    $sha->add($chunk);
                });
                close $out or die "close failed\n";
                die "verification failed\n" unless $response->code == 200
                    && !$response->header('Client-Aborted')
                    && $bytes == $task->{size} && $sha->hexdigest eq $task->{sha};
                rename $file, $task->{file} or die "rename failed\n";
                $ok = 1;
            };
            alarm 0;
            unlink $file if -e $file;
            last if $ok;
        }
        print {$socket} encode_json({ok => $ok}) . "\n" or last;
    }
}

sub fill {
    my ($self, $index) = @_;
    my @idle = grep { !defined $_->{task} } @{$self->{workers}};
    my $end = $index + $self->{window} - 1;
    $end = $#{$self->{plan}} if $end > $#{$self->{plan}};
    for my $i ($index .. $end) {
        last unless @idle;
        next if exists $self->{tasks}{$i};
        my $entry = $self->{plan}[$i];
        # Unknown and oversized objects use the standard downloader. Never
        # treat an unknown size as zero or grow the prefetch budget for it.
        next if !$entry->{size} || $entry->{size} > $self->{budget};
        last if $self->{reserved} + $entry->{size} > $self->{budget};
        my $task = {%$entry, file => "$self->{dir}/$i", status => 'running'};
        $self->{tasks}{$i} = $task;
        $self->{reserved} += $entry->{size};
        $self->{peak} = $self->{reserved} if $self->{reserved} > $self->{peak};
        my $worker = shift @idle;
        $worker->{task} = $i;
        local $SIG{PIPE} = 'IGNORE';
        print {$worker->{socket}} encode_json($task) . "\n"
            or die "prefetch worker unavailable\n";
    }
}

sub receive {
    my ($self) = @_;
    my @busy = grep { defined $_->{task} } @{$self->{workers}};
    die "prefetch has no active worker\n" unless @busy;
    my @ready = IO::Select->new(map { $_->{socket} } @busy)->can_read(250);
    die "prefetch worker deadline exceeded\n" unless @ready;
    for my $socket (@ready) {
        my ($worker) = grep { fileno($_->{socket}) == fileno($socket) } @busy;
        my $line = <$socket>;
        die "prefetch worker exited\n" unless defined $line;
        my $result = decode_json($line);
        my $task = $self->{tasks}{delete $worker->{task}};
        $task->{status} = $result->{ok} ? 'ready' : 'failed';
        $self->{transferred} += $task->{size} if $result->{ok};
    }
}

sub download {
    my ($self, $url, $dest) = @_;
    return undef unless exists $self->{index}{$url} && $dest ne '|';
    my $index = $self->{index}{$url};
    my $entry = $self->{plan}[$index];
    return undef if !$entry->{size} || $entry->{size} > $self->{budget};
    # Discard completed earlier lookahead objects skipped by the installer.
    for my $i (keys %{$self->{tasks}}) {
        next if $i >= $index || $self->{tasks}{$i}{status} eq 'running';
        my $old = delete $self->{tasks}{$i};
        unlink $old->{file};
        $self->{reserved} -= $old->{size};
    }
    my $start = time;
    $self->fill($index);
    # A retry may target an earlier object after lookahead filled the buffer.
    # In that case use the original downloader without blocking on the buffer.
    return undef unless exists $self->{tasks}{$index};
    while ($self->{tasks}{$index}{status} eq 'running') {
        $self->receive;
        $self->fill($index);
    }
    $self->{wait} += time - $start;
    my $task = delete $self->{tasks}{$index};
    $self->{reserved} -= $task->{size};
    my $ok = $task->{status} eq 'ready' && rename $task->{file}, $dest;
    unlink $task->{file} if -e $task->{file};
    $self->fill($index + 1) if $index < $#{$self->{plan}};
    return $ok ? 1 : 0; # Standard unpack checks checksum and size again.
}

sub stop {
    my ($self) = @_;
    return if $self->{stopped}++;
    for my $worker (@{$self->{workers}}) {
        kill 'TERM', $worker->{pid};
        close $worker->{socket};
        waitpid $worker->{pid}, 0;
    }
    $self->{workers} = [];
    printf "TEXLIVE_PREFETCH wait_seconds=%.3f verified_bytes=%d peak_reserved_bytes=%d\n",
        $self->{wait}, $self->{transferred}, $self->{peak};
    my @cpu = times;
    my $cpu_seconds = 0;
    $cpu_seconds += $cpu[$_] - $self->{cpu_start}[$_] for 0 .. 3;
    printf "TEXLIVE_PREFETCH package_seconds=%.3f cpu_seconds=%.3f\n",
        time - $self->{started}, $cpu_seconds;
}

sub DESTROY { $_[0]->stop unless $_[0]->{stopped}; }

sub install {
    my ($db, $media, $target, $packages, $src, $doc) = @_;
    my $workers = setting('TEXLIVE_PREFETCH_WORKERS', 4, 0, 8);
    return $original_install->(@_) if !$workers || $media ne 'NET' || $src || $doc
        || $db->root !~ m{\Ahttps://} || $TeXLive::TLConfig::DefaultCompressorFormat ne 'xz';
    my @plan;
    for my $name (@$packages) {
        die "Unsafe package name\n" unless $name =~ /\A[A-Za-z0-9][A-Za-z0-9_.+-]*\z/;
        my $pkg = $db->get_package($name);
        my $size = $pkg->containersize;
        my $sha = $pkg->containerchecksum // '';
        next unless defined $size && $size =~ /\A[0-9]+\z/ && $size > 0
            && $sha =~ /\A[0-9a-f]{128}\z/;
        push @plan, {url => $db->root . "/archive/$name.tar.xz", size => 0 + $size, sha => $sha};
    }
    return $original_install->(@_) unless @plan;
    $pool = __PACKAGE__->new(\@plan);
    my ($result, $error);
    { local $@; $result = eval { $original_install->(@_) }; $error = $@; }
    $pool->stop;
    undef $pool;
    die $error if $error;
    return $result;
}

{ no warnings 'redefine';
    *TeXLive::TLUtils::install_packages = \&install;
    *TeXLive::TLUtils::download_file = sub {
        if ($pool) {
            my $result = $pool->download(@_);
            return $result if defined $result;
        }
        return $original_download->(@_);
    };
}
END { $pool->stop if $pool; }
1;
