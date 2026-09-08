#!/bin/sh
set -eu
[ "$#" -gt 0 ] || exit 64
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
