require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'photo-saver'
  s.version        = package['version']
  s.summary        = 'PhotoSaver native module for MomentsInFrame'
  s.description    = 'Saves photos to iOS Photos with correct EXIF date and per-event album placement'
  s.author         = 'MomentsInFrame'
  s.homepage       = 'https://momentsinframe.com'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :path => '.' }
  s.source_files   = 'ios/**/*.{swift}'
  s.dependency 'ExpoModulesCore'
end
