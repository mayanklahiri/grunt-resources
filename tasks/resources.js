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

function extractResources(htmlStr, root, options, grunt) {
  // A simple regexp is used to extract the <head> section
  // of the HTML file. This should be sufficient for well-formed
  // HTML documents. Other sections, like <body> are left
  // untouched.
  var reHead = /<head.*?>(.|[\r\n])*<\/head>/mgi;

  // Get contents of the <head> section.
  var headSectionContents = htmlStr.match(reHead);
  if (!headSectionContents || !headSectionContents.length) {
    return { error: 'No <head> section found.' };
  }
  if (headSectionContents.length !== 1) {
    return { error: 'More than 1 <head> section found.' };
  }
  headSectionContents = headSectionContents[0];

  // Get byte boundaries of the <head> section so that we can
  // easily extract it without affecting the rest of the file.
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
    // Only a subset of <head> children are currently supported.
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
        parseResult.error = 'Unsupported tag in HTML <head>: "' + name + '"';
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

  if (parseResult.error) {
    return parseResult;
  }

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

  // Analyze resources and rewrite <head> section.
  var analyzeResult = {
    html: null,
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
      return parseError('Found <script> without "src" attribute; ' +
                        'inline scripts are not currently supported.');
    }
    var scriptSrc = scriptAttribs.src;

    // If the "data-dev" or "dev" attribute is present, drop the script.
    if ('data-dev' in scriptAttribs || 'dev' in scriptAttribs) {
      continue;
    }

    // If the "data-external" or "external" attribute is present, drop
    // the "(data-)external" attribute and pass the script into the
    // minified html file verbatim. This can be used for referencing
    // CDN-hosted scripts.
    if ('data-external' in scriptAttribs || 'external' in scriptAttribs) {
      delete scriptAttribs['data-external'];
      delete scriptAttribs['external'];
      newHead += '  <script' + formatAttribs(scriptAttribs) + '></script>\n';
      continue;
    }

    // Check if file exists.
    scriptSrc = path.join(root, scriptSrc);
    if (!fs.existsSync(scriptSrc)) {
      return parseError('Cannot find referenced file: ' + scriptSrc);
    }

    // Otherwise add the script to the manifest.
    if (scriptSrc.match(/\.min\.js$/)) {
      analyzeResult.script.min.push(scriptSrc);
      grunt.log.writeln('Adding ' + chalk.blue('minified') + ' JS to deps: ' + chalk.blue(scriptSrc));
    } else {
      analyzeResult.script.raw.push(scriptSrc);
      grunt.log.writeln('Adding ' + chalk.green('raw') + ' JS to srcs: ' + chalk.green(scriptSrc));
    }
  }
  // If there are any minified scripts, we will have JS dependencies.
  if (analyzeResult.script.min.length) {
    if (!options.jsDep) {
      return parseError('Found minified JS but no jsDep attribute in options.');
    }
    newHead += '  <script src="' + options.jsDep + '"></script>\n';
  }
  // If there are any raw scripts, we will have JS source.
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
      return parseError('Found <link> without "href" attribute.');
    }
    var linkHref = linkAttribs.href;

    // Check if file exists.
    linkHref = path.join(root, linkHref);
    if (!fs.existsSync(linkHref)) {
      return parseError('Cannot find referenced file: ' + linkHref);
    }

    // Otherwise add the script to the manifest.
    if (linkHref.match(/\.min\.css$/i)) {
      analyzeResult.style.min.push(linkHref);
      grunt.log.writeln('Adding ' + chalk.blue('minified') + ' CSS to deps: ' + chalk.blue(linkHref));
    } else {
      analyzeResult.style.raw.push(linkHref);
      grunt.log.writeln('Adding ' + chalk.green('raw') + ' CSS to srcs: ' + chalk.green(linkHref));
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
    var options = this.options({});

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
      var resources = extractResources(html, path.dirname(srcFile), options, grunt);
      if (resources.error) {
        grunt.fail.warn('Unable to extract resources from ' + chalk.cyan(srcFile) + ': ' + chalk.red(resources.error));
        return false;
      }

      // Write output files.
      if (resources.html) {
        grunt.file.write(f.dest, resources.html);
        grunt.log.writeln('Wrote minified HTML to ' + chalk.cyan(f.dest) + ' ' +
                          prettyBytes(html.length) + ' → ' + prettyBytes(resources.html.length));

        if (options.manifest) {
          // Write manifest to disk
          try { fs.unlinkSync(options.manifest); } catch(e) {}
          var manifest = JSON.stringify({
            html: f.dest,
            script: resources.script,
            style: resources.style,
            output: {
              cssSrc: options.cssSrc || null,
              cssDep: options.cssDep || null,
              jsSrc: options.jsSrc || null,
              jsDep: options.jsDep || null
            },
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
