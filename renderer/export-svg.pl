#!/usr/bin/perl
use strict;
use warnings;
use JSON::PP;
use File::Path qw(make_path);

my ($capture_pdf, $metadata_path, $canonical_pdf, $output_root) = @ARGV;
die "usage: export-svg.pl CAPTURE_PDF METADATA SYNCTEX OUTPUT\n"
  unless defined $output_root;

my $max_objects = positive_env('MAX_SVG_OBJECTS', 200);
my $max_file_bytes = positive_env('MAX_SVG_BYTES', 10 * 1024 * 1024);
my $max_total_bytes = positive_env('MAX_SVG_TOTAL_BYTES', 100 * 1024 * 1024);
my $timeout_seconds = positive_env('SVG_CONVERSION_TIMEOUT_SECONDS', 120);

open my $metadata, '<:encoding(UTF-8)', $metadata_path
  or die "renderer: cannot read SVG metadata: $!\n";
my @metadata_lines = <$metadata>;
my @objects;
die "renderer: invalid SVG metadata\n" if @metadata_lines % 4 != 0;
while (@metadata_lines) {
  my ($object_line, $kind_line, $source_line_value, $line_line) = splice @metadata_lines, 0, 4;
  chomp($object_line, $kind_line, $source_line_value, $line_line);
  my ($sequence) = $object_line =~ /^OBJECT:(\d+)$/;
  my ($kind) = $kind_line =~ /^KIND:(math|tikz)$/;
  my ($source_file) = $source_line_value =~ /^SOURCE:(.+)$/;
  my ($source_line) = $line_line =~ /^LINE:(\d+)$/;
  die "renderer: invalid SVG metadata\n"
    unless defined $sequence && defined $kind && defined $source_file && defined $source_line;
  push @objects, {
    sequence => 0 + $sequence,
    kind => $kind,
    sourceFile => normalized_source($source_file),
    sourceLine => 0 + $source_line,
  };
}
close $metadata;
die "renderer: SVG object limit exceeded\n" if @objects > $max_objects;

my $page_count = @objects ? pdf_pages($capture_pdf) : 0;
die "renderer: SVG capture count mismatch\n" unless $page_count == @objects;
make_path("$output_root/objects", { mode => 0770 });

my (%source_occurrence, %source_count);
for my $object (@objects) {
  my $key = "$object->{sourceFile}:$object->{sourceLine}";
  $source_count{$key} = ($source_count{$key} // 0) + 1;
}
my $total_bytes = 0;
for my $index (0 .. $#objects) {
  my $object = $objects[$index];
  my $id = sprintf('%s-%06d', $object->{kind}, $index + 1);
  my $relative_path = "objects/$id.svg";
  my $destination = "$output_root/$relative_path";
  run_with_timeout(
    $timeout_seconds,
    'pdftocairo', '-svg', '-f', $index + 1, '-l', $index + 1,
    $capture_pdf, $destination,
  );
  my $size = -s $destination;
  die "renderer: SVG conversion did not produce an object\n" unless defined $size;
  die "renderer: SVG object exceeds per-file limit\n" if $size > $max_file_bytes;
  $total_bytes += $size;
  die "renderer: SVG output exceeds total limit\n" if $total_bytes > $max_total_bytes;
  my ($width, $height) = svg_dimensions($destination);
  my $key = "$object->{sourceFile}:$object->{sourceLine}";
  my $occurrence = $source_occurrence{$key} // 0;
  $source_occurrence{$key} = $occurrence + 1;
  my $placement = synctex_placement(
    $canonical_pdf,
    $object->{sourceFile},
    $object->{sourceLine},
    $occurrence,
    $source_count{$key},
    $width,
    $height,
  );
  $object->{id} = $index + 1;
  $object->{artifact} = "svg/$relative_path";
  for my $coordinate (qw(page x y width height)) {
    $object->{$coordinate} = $placement->{$coordinate};
  }
  delete $object->{sequence};
}

my $manifest = {
  schemaVersion => 1,
  coordinateSystem => {
    unit => 'pdf-point',
    origin => 'top-left',
    xAxis => 'right',
    yAxis => 'down',
  },
  objects => \@objects,
};
open my $output, '>:encoding(UTF-8)', "$output_root/manifest.json"
  or die "renderer: cannot write SVG manifest: $!\n";
print {$output} JSON::PP->new->canonical->pretty->encode($manifest);
close $output;

sub positive_env {
  my ($name, $fallback) = @_;
  my $value = $ENV{$name} // $fallback;
  die "renderer: $name must be a positive integer\n"
    unless $value =~ /^\d+$/ && $value > 0;
  return 0 + $value;
}

sub normalized_source {
  my ($path) = @_;
  $path =~ s{^/work/input/}{};
  die "renderer: SVG source path escaped the project\n"
    if $path eq '' || $path =~ m{(?:^|/)\.\.(?:/|$)} || $path =~ m{^/};
  return $path;
}

sub pdf_pages {
  my ($path) = @_;
  open my $pipe, '-|', 'pdfinfo', $path or die "renderer: pdfinfo failed: $!\n";
  my $pages;
  while (my $line = <$pipe>) { $pages = 0 + $1 if $line =~ /^Pages:\s+(\d+)/; }
  close $pipe or die "renderer: pdfinfo failed\n";
  die "renderer: capture PDF page count is missing\n" unless defined $pages;
  return $pages;
}

sub svg_dimensions {
  my ($path) = @_;
  open my $input, '<:encoding(UTF-8)', $path or die "renderer: cannot read SVG: $!\n";
  local $/;
  my $svg = <$input>;
  close $input;
  my ($width) = $svg =~ /\bwidth="([0-9]+(?:\.[0-9]+)?)pt"/;
  my ($height) = $svg =~ /\bheight="([0-9]+(?:\.[0-9]+)?)pt"/;
  die "renderer: SVG dimensions are invalid\n" unless defined $width && defined $height;
  return (0 + $width, 0 + $height);
}

sub synctex_placement {
  my ($canonical_pdf, $source, $line, $occurrence, $source_count, $width, $height) = @_;
  my $absolute = "/work/input/$source";
  open my $pipe, '-|', 'synctex', 'view', '-i', "$line:1:$absolute", '-o', $canonical_pdf
    or die "renderer: synctex query failed: $!\n";
  my (@matches, %current);
  while (my $row = <$pipe>) {
    chomp $row;
    if ($row eq 'SyncTeX result end') {
      push @matches, { %current } if defined $current{page};
      %current = ();
      next;
    }
    $current{page} = 0 + $1 if $row =~ /^Page:(\d+)/;
    $current{x} = 0 + $1 if $row =~ /^x:([-0-9.]+)/;
    $current{y} = 0 + $1 if $row =~ /^y:([-0-9.]+)/;
    $current{lineWidth} = 0 + $1 if $row =~ /^W:([-0-9.]+)/;
  }
  close $pipe;
  push @matches, { %current } if defined $current{page};
  die "renderer: no canonical PDF placement for $source:$line\n" unless @matches;
  my $match = $matches[$occurrence] // $matches[-1];
  my $x = $match->{x} // 0;
  if (@matches < $source_count && ($match->{lineWidth} // 0) > 0) {
    # SyncTeX may collapse repeated inline objects on one source line into a
    # single line box. Distribute those objects within that measured box in
    # execution order so every source instance has a stable placement.
    my $slot = $match->{lineWidth} / $source_count;
    $x += ($slot * ($occurrence + 0.5)) - ($width / 2);
  }
  return {
    page => $match->{page},
    x => round_point($x),
    y => round_point(($match->{y} // $height) - $height),
    width => round_point($width),
    height => round_point($height),
  };
}

sub round_point { return 0 + sprintf('%.3f', $_[0]); }

sub run_with_timeout {
  my ($seconds, @command) = @_;
  system('timeout', '-s', 'TERM', '-k', '2', $seconds, @command) == 0
    or die "renderer: SVG conversion failed\n";
}
