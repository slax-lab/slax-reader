Pod::Spec.new do |s|
  s.name = 'SlaxPlatform'
  s.version = '1.0.0'
  s.summary = 'Slax Reader platform services and rich reader view'
  s.author = 'Slax Reader'
  s.homepage = 'https://github.com/slax/slax-reader'
  s.license = { :type => 'Apache-2.0' }
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'GoogleSignIn'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
