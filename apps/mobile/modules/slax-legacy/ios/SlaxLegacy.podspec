Pod::Spec.new do |s|
  s.name = 'SlaxLegacy'
  s.version = '1.0.0'
  s.summary = 'Slax Reader installation data and preference compatibility'
  s.description = 'App-owned migration inventory, exclusive database ownership, and shared preference storage.'
  s.author = 'Slax Reader'
  s.homepage = 'https://github.com/slax/slax-reader'
  s.license = { :type => 'MIT' }
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.libraries = 'sqlite3'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
