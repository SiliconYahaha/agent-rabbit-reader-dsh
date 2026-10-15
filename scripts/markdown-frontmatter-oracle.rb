# Independent delimiter oracle, not a full YAML metadata implementation.
# Jekyll Document::YAML_FRONT_MATTER_REGEXP, commit 74d751339d3e534aa51d5d7b0640e9bd743509e4.
# https://github.com/jekyll/jekyll/blob/74d751339d3e534aa51d5d7b0640e9bd743509e4/lib/jekyll/document.rb#L13
require 'json'
pattern = /\A(---\s*\n.*?\n?)^((---|\.\.\.)\s*$\n?)/m
cases = JSON.parse(File.read(ARGV.fetch(0)))
cases.each do |sample|
  # Match the reader's documented newline/BOM normalization before comparing delimiters.
  source = sample.fetch('source').gsub(/\r\n?/, "\n").sub(/\A\uFEFF/, '')
  match = pattern.match(source)
  sample['recognized'] = !!match
  sample['expectedBody'] = match ? source[match.end(0)..-1].sub(/\A\n+/, '') : source
end
File.write(ARGV.fetch(1), JSON.pretty_generate(cases)+"\n")
