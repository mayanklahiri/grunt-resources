/*
 * grunt-resources
 * https://github.com/mayanklahiri/grunt-resources
 *
 * Copyright (c) 2015 Mayank Lahiri <mlahiri@gmail.com>
 * Licensed under the MIT license.
 */
'use strict';

var fs = require('fs'),
    path = require('path'),
    chalk = require('chalk'),
    htmlparser = require('htmlparser2'),
    prettyBytes = require('pretty-bytes');

function extractResources(htmlStr, options) {
  var reHead = /<head>(.|[\r\n])*<\/head>/mgi;

  // Get contents of the <head> section.
  var headSectionContents = htmlStr.match(reHead);
  if (!headSectionContents || !headSectionContents.length) {
    return { error: 'No <head> section found.' };
  }
  if (headSectionContents.length !== 1) {
    return { error: 'More than 1 <head> section found.' };
  }
  headSectionContents = headSectionContents[0];

  // Get boundaries of the <head> section.
  var headSectionStart = htmlStr.search(reHead);
  var headSectionLength = headSectionContents.length;

  // Parse HTML
  var parseResult = {
    head: null,
    title: null,
    script: [],
    link: [],
    meta: [],
    _text: null,
  };
  var parseError = function(msg) {
    parseResult.error = msg;
    return parseResult;
  };
  var parser = new htmlparser.Parser({
    onopentag: function(name, attribs) {
      parseResult._text = null;
      if (name === 'script') {
        parseResult.script.push(attribs);
      } else if (name === 'head') {
        parseResult.head = attribs;
      } else if (name === 'title') {
        parseResult.title = attribs;
      } else if (name === 'link') {
        parseResult.link.push(attribs);
      } else if (name === 'meta') {
        parseResult.meta.push(attribs);
      } else {
        return parseError('Unrecognized tag in HTML head: "' + name + '"');
      }
    },
    ontext: function(text) {
      parseResult._text = (parseResult._text || '') + text;
    },
    onclosetag: function(tagname) {
      if(tagname === 'title') {
        parseResult.title = parseResult._text;
      }
    },
  });
  parser.write(headSectionContents);
  parser.end();

  if (!parseResult.head) {
    return parseError('No <head> tag found.');
  }

  function formatAttribs(attribs) {
    var r = [];
    for (var key in attribs) {
      var value = attribs[key];
      r.push(key + '="' + value + '"');
    }
    if (r.length) {
      return ' ' + r.join(' ');
    }
    return '';
  }

  // Analyze resources and generate new HEAD section.
  var analyzeResult = {
    script: {
      min: [],
      raw: [],
    },
    style: {
      min: [],
      raw: [],
    },
  };
  var newHead = '<head' + formatAttribs(parseResult.head) + '>\n';

  // Insert <meta> tags first.
  for (var i = 0; i < parseResult.meta.length; i++) {
    var metaAttribs = parseResult.meta[i];
    newHead += '  <meta' + formatAttribs(metaAttribs) + '>\n';
  }

  // Insert <title> if it is defined.
  if (parseResult.title) {
    newHead += '  <title>' + parseResult.title + '</title>\n';
  }

  // Analyze / transform <script> tags
  for (i = 0; i < parseResult.script.length; i++) {
    var scriptAttribs = parseResult.script[i];

    if (!scriptAttribs.src) {
      return parseError('<script> without <src>: ' + scriptAttribs);
    }
    var scriptSrc = scriptAttribs.src;
    // TODO: ensure source file exists.

    // If the "data-dev" or "dev" attribute is present, drop the script.
    if ('data-dev' in scriptAttribs || 'dev' in scriptAttribs) {
      continue;
    }

    // If the "data-external" or "external" attribute is present, drop
    // the attribute and pass the script into the minified html file verbatim.
    if ('data-external' in scriptAttribs || 'external' in scriptAttribs) {
      delete scriptAttribs['data-external'];
      delete scriptAttribs['external'];
      newHead += '  <script' + formatAttribs(scriptAttribs) + '></script>\n';
      continue;
    }

    // Otherwise add the script to the manifest.
    if (scriptSrc.match(/\.min\.js$/)) {
      analyzeResult.script.min.push(scriptSrc);
    } else {
      analyzeResult.script.raw.push(scriptSrc);
    }
  }
  // If there are any minified scripts, we will have JS dependencies.
  if (analyzeResult.script.min.length) {
    if (!options.jsDep) {
      return parseError('Found minified JS but no jsDep attribute in options.');
    }
    newHead += '  <script src="' + options.jsDep + '"></script>\n';
  }
  if (analyzeResult.script.raw.length) {
    if (!options.jsSrc) {
      return parseError('Found raw JS but no jsSrc attribute in options.');
    }
    newHead += '  <script src="' + options.jsSrc + '"></script>\n';
  }

  // Analyze / transform <link> tags
  for (i = 0; i < parseResult.link.length; i++) {
    var linkAttribs = parseResult.link[i];
    if (!linkAttribs.href) {
      return parseError('<link> without <href>: ' + linkAttribs);
    }
    var linkHref = linkAttribs.href;
    // TODO: ensure source file exists.

    // Otherwise add the script to the manifest.
    if (linkHref.match(/\.min\.css$/)) {
      analyzeResult.style.min.push(linkHref);
    } else {
      analyzeResult.style.raw.push(linkHref);
    }
  }

  // If there are any minified stylesheets, we will have CSS dependencies.
  if (analyzeResult.style.min.length) {
    if (!options.cssDep) {
      return parseError('Found minified CSS but no cssDep attribute in options.');
    }
    newHead += '  <link rel="stylesheet" href="' + options.cssDep + '">\n';
  }
  if (analyzeResult.style.raw.length) {
    if (!options.cssSrc) {
      return parseError('Found raw CSS but no cssSrc attribute in options.');
    }
    newHead += '  <link rel="stylesheet" href="' + options.cssSrc + '">\n';
  }

  newHead += '</head>';

  // Generate final output.
  analyzeResult.html = htmlStr.substr(0, headSectionStart) +
                       newHead +
                       htmlStr.substr(headSectionStart + headSectionLength);

  return analyzeResult;
}


module.exports = function(grunt) {

  grunt.registerMultiTask('resources', 'Extracts loadable resources (JS, CSS, etc) from an HTML file in preparation for minification.', function() {
    // Merge task-specific and/or target-specific options with these defaults.
    var options = this.options({
      punctuation: '.',
      separator: ', '
    });

    // Force task into async mode and grab a handle to the "done" function.
    var done = this.async();

    // Iterate over all specified file groups.
    this.files.forEach(function(f) {
      if (!f || !f.src || f.src.length !== 1) {
        grunt.log.warn('The resources task requires exactly 1 HTML file specified as src.');
        return false;
      }
      if (!f.dest) {
        grunt.log.warn('The resources task requires exactly 1 HTML file specified as dest.');
        return false;
      }

      // Read the source HTML file.
      var srcFile = f.src[0];
      var html = grunt.file.read(srcFile);
      grunt.log.writeln('Extracting resources from HTML file ' + chalk.cyan(srcFile));

      // Parse the HTML and extract resources.
      var resources = extractResources(html, options);

      // Write output files.
      if (resources.html) {
        grunt.file.write(f.dest, resources.html);
        grunt.log.writeln('Wrote minified HTML to ' + chalk.cyan(f.dest) + ' ' +
                          prettyBytes(html.length) + ' → ' + prettyBytes(resources.html.length));

        if (options.manifest) {
          // Write manifest to disk
          try { fs.unlinkSync(options.manifest); } catch(e) {}
          var manifest = JSON.stringify({
            script: resources.script,
            style: resources.style,
          }, undefined, 2);
          grunt.file.write(options.manifest, manifest);
          grunt.log.writeln('Wrote manifest to ' + chalk.cyan(options.manifest));
        }
      } else {
        grunt.log.warn('No HTML produced, not writing ' + chalk.red(f.dest) +
                       ' error=' + chalk.red(resources.error));
        return false;
      }
    });

    done();
  });

};
