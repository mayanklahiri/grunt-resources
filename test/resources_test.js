'use strict';

var grunt = require('grunt');

/*
  ======== A Handy Little Nodeunit Reference ========
  https://github.com/caolan/nodeunit

  Test methods:
    test.expect(numAssertions)
    test.done()
  Test assertions:
    test.ok(value, [message])
    test.equal(actual, expected, [message])
    test.notEqual(actual, expected, [message])
    test.deepEqual(actual, expected, [message])
    test.notDeepEqual(actual, expected, [message])
    test.strictEqual(actual, expected, [message])
    test.notStrictEqual(actual, expected, [message])
    test.throws(block, [error], [message])
    test.doesNotThrow(block, [error], [message])
    test.ifError(value)
*/

exports.resources = {
  setUp: function(done) {
    // setup here if necessary
    done();
  },
  default_options: function(test) {
    test.expect(2);

    var actual = grunt.file.read('tmp/basic.min.html');
    var expected = grunt.file.read('test/expected/basic.min.html');
    test.equal(actual, expected, 'rewritten HTML should match.');

    var actualManifest = grunt.file.readJSON('tmp/manifest.json');
    var expectedManifest = grunt.file.readJSON('test/expected/basic.manifest.json');
    test.deepEqual(actualManifest, expectedManifest, 'manifest should match.');

    test.done();
  },
};
