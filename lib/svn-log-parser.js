"use strict";

var stream = require("stream")
  , util = require("util")
  , path = require("path")
;

module.exports = function createParser( callback, opts, logs ) {
  var args = processArgs(logs, opts, callback);
  logs = args.logs;
  opts = args.opts;
  callback = args.callback;

  var parser = new Parser(opts, callback);

  if (typeof logs === "string") {
    parser.write(logs);
  }

  return parser;
};

function Parser( opts, callback ) {
  stream.Stream.call(this);

  for (var key in opts) {
    if (~reserved.indexOf(key)) {
      this[key] = opts[key];
    }
  }
  this.done = callback;

  this.results = {
      files: {}
    , revs: {}
  };
}
util.inherits(Parser, stream.Stream);

Parser.prototype.readable = true;
Parser.prototype.writable = true;
Parser.prototype.pipe = function( dest, opts ) {
  stream.Stream.prototype.pipe.call(this, dest, opts);
  return dest;
};
Parser.prototype.write = function( data ) {
  var parser = this;

  var lines = "".split.call(data, /[\n\r]+/);

  lines.forEach(function( line ) {
    var revInfo
      , actionInfo
    ;

    switch (whatIsLine(line)) {
      case "sep":
        break;
      case "rev":
        if (parser.currRev) {
          parser.emit("rev", parser.results.revs[parser.currRev]);
        }
        revInfo = parseRevInfo(line);
        parser.currRev = revInfo.rev;
        parser.results.revs[parser.currRev] = revInfo;
        break;
      case "action":
        actionInfo = parseActionInfo(line);
        actionInfo.rev = parser.currRev;
        updateFileInfo(parser, actionInfo);
        break;
      default:
        // Assume revision message
        if (parser.currRev != null) {
          parser.results.revs[parser.currRev].message += line;
        }
    }
  });
};
Parser.prototype.end = function( chunk ) {
  if (!this._ended) {
    this._ended = true;

    if (chunk) {
      this.write(chunk);
    }

    if (this.currRev) {
      this.emit("rev", this.results.revs[this.currRev]);
    }

    this.emit("end", this.results);

    if (typeof this.done == "function") {
      this.done(this.results);
    }
  } else {
    throw "Already ended!";
  }
};
Parser.prototype.pause = function () {
  // Pause?
};
Parser.prototype.resume = function () {
  // Resume?
};
Parser.prototype.destroy = function () {
  this.end();
};

function processArgs( logs, opts, callback ) {
  if (typeof logs !== "string") {
    callback = opts;
    opts = logs;
    logs = "";
  }

  if (typeof opts !== "object") {
    callback = opts;
    opts = {};
  }

  if (typeof callback !== "function") {
    callback = null;
  }

  return {
      logs: logs
    , opts: opts
    , callback: callback
  };
}

var sepTest = /^-+$|^Changed paths:$/
  , fromTest = / \(from .+:\d+\)$/
  , revTest = /^r\d+ \| [^\|]+ \| [^\|]+ \| /
  , actionTest = /^ +[AMDR] +[^ ]+/ // This test should be better!
  , revMatcher = /^r(\d+) \| ([^\|]+) \| ([^\|]+) \| /
  , actionMatcher = /^ +([AMDR]) +(.+)$/
;

function parseRevInfo( line ) {
  var revMatch = revMatcher.exec(line);
  return {
      rev: Number(revMatch[1])
    , author: revMatch[2]
    , timestamp: revMatch[3]
    , actions: {}
    , message: ""
  };
}

function parseActionInfo( line ) {
  var actionMatch = actionMatcher.exec(line.replace(fromTest, ""));
  return {
      action: actionMatch[1]
    , file: actionMatch[2]
  };
}

function updateFileInfo( parser, actionInfo ) {
  var fileInfo;

  if (!parser.results.files[actionInfo.file]) {
    parser.results.files[actionInfo.file] = { revs: [] };

    Object.defineProperty(parser.results.files[actionInfo.file], "lastAction", {
        enumerable: true
      , get: function() {
          var lastRev = fileInfo.revs[fileInfo.revs.length - 1]
            , lastAction = parser.results.revs[lastRev].actions[actionInfo.file]
            , pathName
            , pathInfo
            , lastPathRev
            , lastPathAction
            , pathSplit = actionInfo.file.split(path.sep)
          ;

          while (lastAction.action !== "D" && pathSplit.pop()) {
            pathName = pathSplit.join(path.sep);
            pathInfo = parser.results.files[pathName];

            if (!pathInfo) continue;

            lastPathAction = pathInfo.lastAction;

            if (lastPathAction.rev > lastRev && lastPathAction.action === "D") {
              lastAction = lastPathAction;
            }
          }

          return lastAction;
        }
    });
  }

  fileInfo = parser.results.files[actionInfo.file];

  fileInfo.revs.unshift(parser.currRev);

  parser.results.revs[parser.currRev].actions[actionInfo.file] = actionInfo;

  parser.emit("action", {
      action: actionInfo.action
    , file: actionInfo.file
    , rev: parser.currRev
  });

  return fileInfo;
}

function whatIsLine( line ) {
  if (actionTest.test(line)) {
    return "action";
  }

  if (sepTest.test(line)) {
    return "sep";
  }

  if (revTest.test(line)) {
    return "rev";
  }

  return "other";
}

var reserved = Object.keys(Parser.prototype);
