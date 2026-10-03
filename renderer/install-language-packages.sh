#!/bin/sh
set -eu
[ "$#" -gt 0 ] || exit 64
# Runtime's post-install phase only: never run concurrent tlmgr installations.
# The helper is part of the existing Runtime source fingerprint, so changing
# this algorithm also changes Runtime identity without changing release schema.
if [ "$1" = --rebuild-formats ]; then
  [ "$#" -eq 1 ] || exit 64
  jobs=${TEXLIVE_FORMAT_JOBS:-1}
  case "$jobs" in 1|2|4) ;; *) echo 'TEXLIVE_FORMAT_JOBS must be 1, 2 or 4' >&2; exit 64 ;; esac
  printf 'TEXLIVE_FORMAT_JOBS=%s\n' "$jobs"
  if [ "$jobs" -eq 1 ]; then exec fmtutil-sys --all; fi
  exec perl - "$jobs" <<'FORMAT_BUILD'
use strict;
use warnings;
use File::Temp ();
use POSIX ();
my $jobs = shift @ARGV;
my (%expected, %seen, %active);
open my $cfg, '-|', 'fmtutil-sys', '--listcfg' or die "Cannot list formats\n";
while (my $line = <$cfg>) {
    chomp $line;
    if ($line =~ /\A([A-Za-z0-9._+-]+) \(engine=([A-Za-z0-9._+-]+)\) (enabled|disabled)\z/) {
        my ($format, $engine, $state) = ($1, $2, $3);
        die "Duplicate format configuration\n" if $seen{"$format/$engine"}++;
        $expected{$engine}{$format} = 1 if $state eq 'enabled';
    } elsif ($line !~ /\A(?:List of all formats:|  (?:hyphen=|origin=)|fmtutil(?::| \[)|\s*\z)/) {
        die "Unrecognized format configuration\n";
    }
}
close $cfg or die "Format listing failed\n";
my @queue = sort keys %expected;
die "No enabled formats\n" unless @queue;
my $format_count = 0;
$format_count += keys %{$expected{$_}} for @queue;
printf "TEXLIVE_FORMAT_PLAN engines=%d formats=%d jobs=%d\n", scalar(@queue), $format_count, $jobs;
my $temporary = File::Temp->newdir('texlive-formats-XXXXXXXX', TMPDIR => 1);
sub stop_children {
    # Every child owns a private process group including its TeX subprocesses.
    kill 'TERM', map { -$_ } keys %active;
    select undef, undef, undef, 0.2 if %active;
    kill 'KILL', map { -$_ } keys %active;
    for my $pid (keys %active) { waitpid $pid, 0; }
    %active = ();
}
sub start_child {
    my ($engine, $status, @command) = @_;
    my $blocked = POSIX::SigSet->new(POSIX::SIGTERM(), POSIX::SIGINT(), POSIX::SIGHUP(), POSIX::SIGALRM());
    my $previous = POSIX::SigSet->new();
    POSIX::sigprocmask(POSIX::SIG_BLOCK(), $blocked, $previous) or die "Cannot block signals\n";
    my $pid = fork();
    die "Cannot fork format builder\n" unless defined $pid;
    if (!$pid) {
        $SIG{TERM} = $SIG{INT} = $SIG{HUP} = $SIG{ALRM} = 'DEFAULT';
        defined(POSIX::setpgid(0, 0)) or POSIX::_exit(70);
        POSIX::sigprocmask(POSIX::SIG_SETMASK(), $previous) or POSIX::_exit(70);
        exec @command or POSIX::_exit(70);
    }
    $active{$pid} = [$engine, $status];
    # Close the fork-to-exec group creation race before accepting signals.
    POSIX::setpgid($pid, $pid);
    POSIX::sigprocmask(POSIX::SIG_SETMASK(), $previous) or die "Cannot restore signals\n";
    return $pid;
}
$SIG{TERM} = $SIG{INT} = $SIG{HUP} = sub { die "Format generation interrupted\n"; };
$SIG{ALRM} = sub { die "Format generation deadline exceeded\n"; };
my $ok = eval {
    alarm 600;
    while (@queue || %active) {
        while (@queue && keys(%active) < $jobs) {
            my $engine = shift @queue;
            my $status = "$temporary/$engine.status";
            start_child($engine, $status, 'fmtutil-sys', '--strict', '--nohash',
                '--byengine', $engine, '--status-file', $status);
        }
        # Perl may retain a reaped pipe child's status from --listcfg. Poll
        # only our owned PIDs, never wait() for an unrelated/cached child.
        my ($pid, $exit);
        until (defined $pid) {
            for my $owned (keys %active) {
                my $done = waitpid($owned, POSIX::WNOHANG());
                die "Cannot wait for format builder\n" if $done < 0;
                if ($done == $owned) { ($pid, $exit) = ($owned, $?); last; }
            }
            select undef, undef, undef, 0.02 unless defined $pid;
        }
        my ($engine, $status) = @{delete $active{$pid}};
        die "Format builder failed for $engine\n" if $exit;
        open my $report, '<', $status or die "Missing format status for $engine\n";
        my %built;
        while (my $line = <$report>) {
            my ($state, $format, $reported_engine) = split ' ', $line;
            if ($state eq 'SUCCESS') {
                die "Unexpected format status\n" unless $reported_engine eq $engine
                    && $expected{$engine}{$format} && !$built{$format}++;
            } elsif ($state ne 'NOTSELECTED' && $state ne 'DISABLED') {
                die "Incomplete format status for $engine\n";
            }
        }
        close $report or die "Cannot read format status\n";
        die "Missing generated formats for $engine\n" unless keys(%built) == keys(%{$expected{$engine}});
    }
    # --nohash prevents all workers from racing on the shared ls-R index.
    # Refresh it once only after every enabled format has been rebuilt.
    my $index_pid = start_child('__index', undef, 'mktexlsr');
    waitpid($index_pid, 0) == $index_pid or die "Cannot wait for format index update\n";
    my $index_exit = $?;
    delete $active{$index_pid};
    die "Final format index update failed\n" if $index_exit;
    printf "TEXLIVE_FORMAT_COMPLETED formats=%d\n", $format_count;
    1;
};
alarm 0;
if (!$ok) {
    my $failure = $@;
    local $SIG{TERM} = local $SIG{INT} = local $SIG{HUP} = 'IGNORE';
    stop_children();
    die $failure;
}
FORMAT_BUILD
fi
for language in "$@"; do
  case "$language" in collection-lang*) ;; *) exit 64 ;; esac
  case "${language#collection-lang}" in ''|*[!A-Za-z0-9._-]*) exit 64 ;; esac
done

check_dependencies() {
  texlive_root=$(kpsewhich -var-value=SELFAUTOPARENT) || return 1
  [ -n "$texlive_root" ] && [ -d "$texlive_root/tlpkg" ] || return 1
  # The shipped bin/<arch>/man symlink targets this directory even when
  # docfiles are disabled. Keep the empty directory so check files can follow
  # the genuine link; do not suppress missing-file diagnostics or add docs.
  mkdir -p "$texlive_root/texmf-dist/doc/man" || return 1
  perl -I"$texlive_root/tlpkg" -MTeXLive::TLPDB - "$texlive_root" "$@" <<'PERL'
use strict;
use warnings;
my $root = shift @ARGV;
my $db = TeXLive::TLPDB->new(root => $root) or die "Cannot load installed TeX database\n";
my @missing;
for my $requested (@ARGV) {
    push @missing, "requested collection $requested" unless $db->get_package($requested);
}
for my $name ($db->list_packages) {
    next if $name =~ /^00texlive/;
    for my $dependency ($db->get_package($name)->depends) {
        # Match the installed DB's standard dependency check: .ARCH is a
        # conditional placeholder, not a package name. Windows is not enabled.
        next if $dependency =~ /\.(?:ARCH|windows)$/;
        push @missing, "$dependency (required by $name)" unless $db->get_package($dependency);
    }
}
if (@missing) {
    print STDERR "Missing TeX dependencies:\n", map { "  $_\n" } @missing;
    exit 65;
}
# Do not require every installed package to belong to an installed collection.
# The language-neutral Base intentionally includes standalone language fonts.
PERL
}

# tlmgr can return success after rejecting a corrupted dependency download.
# Check the resulting dependency graph and files, not only its exit status.
if tlmgr install "$@" && check_dependencies "$@" && tlmgr check files; then
  exit 0
fi
echo 'Language installation incomplete; retrying once with reinstallation.' >&2
# Reinstalling a collection also reinstalls its package dependencies, including
# one incorrectly recorded as installed or forcibly removed by an earlier try.
if tlmgr install --reinstall "$@" && check_dependencies "$@" && tlmgr check files; then
  exit 0
fi
echo 'Language installation remains incomplete after two attempts.' >&2
exit 65
