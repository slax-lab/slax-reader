require 'xcodeproj'
require 'fileutils'
root = File.expand_path(ARGV.fetch(0))
raise 'Existing UI project' if File.exist?(File.join(root, 'ResetUI.xcodeproj'))
FileUtils.mkdir_p(root)
project = Xcodeproj::Project.new(File.join(root, 'ResetUI.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'ResetUI', :ios, '16.4')
file = project.main_group.new_file(File.expand_path('ResetUITests.swift', __dir__))
target.source_build_phase.add_file_reference(file)
target.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'app.slax.resetacceptance.uitests'
  config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  config.build_settings['SWIFT_VERSION'] = '5.0'
  config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
  config.build_settings['SDKROOT'] = 'iphonesimulator'
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(project.path, 'ResetUI', true)
puts project.path
