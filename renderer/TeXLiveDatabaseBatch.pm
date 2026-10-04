package TeXLiveDatabaseBatch;
use strict;
use warnings;
use Digest::SHA ();
use File::Basename qw(dirname);
use File::Temp ();
use Scalar::Util qw(blessed refaddr);
use Time::HiRes qw(clock_gettime CLOCK_MONOTONIC);
use JSON::PP qw(encode_json);
use TeXLive::TLUtils ();
die "Load TeXLiveDatabaseBatch before TeXLivePrefetch\n" if exists $INC{'TeXLivePrefetch.pm'};

# Load BEFORE TeXLivePrefetch: its package metrics then include the final flush.
# Only the local target DB is intercepted. Signed source metadata and package
# order/checksums/extraction remain the standard installer's responsibility.
my $original_install = \&TeXLive::TLUtils::install_packages;
my $nonresuming_install = $0 =~ m{(?:\A|/)install-tl\z}
    && grep { $_ eq '--no-continue' } @ARGV;
our $active_owner;

sub cpu {
    my @value = times;
    return $value[0] + $value[1] + $value[2] + $value[3];
}

sub measured_save {
    my $state = shift;
    my $context = wantarray;
    my ($result, @results, $ok, $error);
    my $started = clock_gettime(CLOCK_MONOTONIC);
    my $cpu = cpu();
    {
        local $@;
        $ok = eval {
            if (!defined $context) { $state->{save}->(@_); }
            elsif ($context) { @results = $state->{save}->(@_); }
            else { $result = $state->{save}->(@_); }
            1;
        };
        $error = $@;
    }
    $state->{report}{physical}++;
    $state->{report}{save_elapsed_seconds} += clock_gettime(CLOCK_MONOTONIC) - $started;
    $state->{report}{save_cpu_seconds} += cpu() - $cpu;
    die $error unless $ok;
    return unless defined $context;
    return $context ? @results : $result;
}

sub flush {
    my ($state) = @_;
    return unless $state->{pending};
    # Supported upstream save returns unlink's success after replacing the DB.
    # A false result must never be reinterpreted as a successful checkpoint.
    measured_save($state, $state->{target}) or die "Local TeX database save failed\n";
    verify_database($state);
    $state->{pending} = 0;
}

# Use a real filehandle: upstream TLPOBJ::writeout also uses Perl format/write,
# which bypasses tied PRINT handles. One temporary serialization lives beside
# the local DB and is removed on success/exception, never kept as a cache.
sub verify_database {
    my ($state) = @_;
    my $started = clock_gettime(CLOCK_MONOTONIC);
    my $cpu = cpu();
    my $path = $state->{target}->location;
    my $serialization = File::Temp->new(
        DIR => dirname($path), TEMPLATE => 'texlive.tlpdb.verify-XXXXXX', UNLINK => 1);
    binmode $serialization or die "Cannot serialize local TeX database bytes\n";
    $state->{target}->writeout($serialization);
    die "Cannot write local TeX database serialization\n" if $serialization->error;
    $serialization->flush or die "Cannot flush local TeX database serialization\n";
    my $size = (stat($serialization))[7];
    $state->{report}{verification_peak_bytes} = $size
        if $size > $state->{report}{verification_peak_bytes};
    seek($serialization, 0, 0) or die "Cannot rewind local TeX database serialization\n";
    my $sha = Digest::SHA->new(512);
    $sha->addfile($serialization);
    close $serialization or die "Cannot close local TeX database serialization\n";
    my $expected = $sha->hexdigest;
    die "Local TeX database is not a regular file\n" unless -f $path && !-l $path;
    open my $input, '<', $path or die "Cannot read local TeX database\n";
    binmode $input or die "Cannot read local TeX database bytes\n";
    my $actual = Digest::SHA->new(512);
    $actual->addfile($input);
    close $input or die "Cannot close local TeX database\n";
    die "Local TeX database differs from standard serialization\n"
        unless $actual->hexdigest eq $expected;
    $state->{report}{final_sha512} = $expected;
    $state->{report}{verified}++;
    $state->{report}{verify_elapsed_seconds} = ($state->{report}{verify_elapsed_seconds} // 0)
        + clock_gettime(CLOCK_MONOTONIC) - $started;
    $state->{report}{verify_cpu_seconds} = ($state->{report}{verify_cpu_seconds} // 0) + cpu() - $cpu;
}

sub install {
    my $batch = $ENV{TEXLIVE_DATABASE_SAVE_BATCH} // 1;
    die "Invalid TEXLIVE_DATABASE_SAVE_BATCH\n"
        unless $batch =~ /\A[0-9]+\z/ && $batch >= 1 && $batch <= 64;
    my ($source, $media, $target, $packages, $src, $doc) = @_;
    my $supported = blessed($target) && ref($target) eq 'TeXLive::TLPDB'
        && $target->can('save') && $target->can('writeout')
        && $target->can('is_virtual') && $target->can('location') && $target->can('root');
    my $postaction = TeXLive::TLUtils->can('do_postaction');
    if ($batch > 1) {
        die "Nested database batching is unsupported\n" if defined($active_owner) && $active_owner == $$;
        die "Database batching requires disposable non-resuming CI install-tl\n"
            unless ($ENV{TEXLIVE_DISPOSABLE_CI} // '') eq '1'
                && $nonresuming_install;
        die "Unsupported TeX database batching scope\n"
            unless $supported && $postaction && $media eq 'NET' && !$src && !$doc
                && blessed($source) && refaddr($source) != refaddr($target)
                && !$target->is_virtual;
        my $root = $target->root;
        die "Unsafe local TeX database location\n" unless defined($root)
            && $root =~ m{\A/(?:[A-Za-z0-9_.+-]+/)*[A-Za-z0-9_.+-]+\z}
            && $root !~ m{(?:\A|/)\.{1,2}(?:/|\z)}
            && $target->location eq "$root/tlpkg/texlive.tlpdb";
    }
    # Unknown future helper APIs retain the original serial path, but cannot
    # silently enable the explicitly requested batching candidate.
    return $original_install->(@_) unless $supported;
    local $active_owner = $$;
    my $state = {target => $target, owner => $$, pending => 0,
        save => $target->can('save'),
        report => {schema => 1, batch => 0 + $batch, requested => 0, physical => 0,
            deferred => 0, save_elapsed_seconds => 0, save_cpu_seconds => 0,
            verified => 0,
            verification_peak_bytes => 0,
            verify_elapsed_seconds => undef, verify_cpu_seconds => undef,
            final_sha512 => undef}};
    my $context = wantarray;
    my ($result, @results, $ok, $error);
    {
        no warnings 'redefine';
        local *TeXLive::TLPDB::save = sub {
            # Other databases, source metadata, and forked workers are never
            # batched or counted as target DB saves.
            return $state->{save}->(@_) unless $$ == $state->{owner}
                && refaddr($_[0]) == refaddr($state->{target});
            $state->{report}{requested}++;
            return measured_save($state, @_) if $batch == 1;
            # Unknown future save semantics must fail rather than be deferred.
            die "Unsupported local TeX database save arguments\n" if @_ != 1;
            $state->{pending}++;
            if ($state->{pending} >= $batch) { flush($state); }
            else { $state->{report}{deferred}++; }
            return 1;
        };
        local *TeXLive::TLUtils::do_postaction = sub {
            if ($batch > 1 && $$ == $state->{owner}) {
                my $package = $_[1];
                # Even disabled/unknown postactions trigger a conservative
                # checkpoint. Never suppress or reorder the standard action.
                flush($state) if !blessed($package) || !$package->can('postactions')
                    || scalar($package->postactions);
            }
            return $postaction->(@_);
        } if $postaction;
        local $@;
        $ok = eval {
            if (!defined $context) { $original_install->(@_); }
            elsif ($context) { @results = $original_install->(@_); }
            else { $result = $original_install->(@_); }
            flush($state) if $batch > 1;
            verify_database($state);
            1;
        };
        $error = $@;
    }
    # No END/signal-handler flush: a killed/failed disposable RUN is discarded,
    # not marked complete or resumed with stale checkpoints.
    $state->{report}{returned} = $ok ? 1 : 0;
    $state->{report}{pending} = $state->{pending};
    for my $key (qw(save_elapsed_seconds save_cpu_seconds verify_elapsed_seconds verify_cpu_seconds)) {
        $state->{report}{$key} = 0 + sprintf('%.3f', $state->{report}{$key})
            if defined $state->{report}{$key};
    }
    print 'TEXLIVE_DATABASE_SAVES ', encode_json($state->{report}), "\n";
    die $error unless $ok;
    return unless defined $context;
    return $context ? @results : $result;
}

{ no warnings 'redefine'; *TeXLive::TLUtils::install_packages = \&install; }

1;
