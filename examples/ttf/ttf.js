var fs = require('fs');
var path = require('path');
var exists = fs.existsSync || path.existsSync;

var vendors = require('./vendors');
var labels = require('./labels');



module.exports = Font;


var reified = require('reified');
reified.defaultEndian = 'BE';
var Int8 = reified.NumericType.Int8;
var Uint8 = reified.NumericType.Uint8;
var Int16 = reified.NumericType.Int16;
var Uint16 = reified.NumericType.Uint16;
var Int32 = reified.NumericType.Int32;
var Uint32 = reified.NumericType.Uint32;


var flatten = Function.apply.bind([].concat, []);
function inspect(o){ console.log(require('util').inspect(o, false, 6)) }




function Font(buffer, filename){
  this.filename = filename;
  this.name = filename.slice(0, -path.extname(filename).length);

  // FontIndex is the entry point
  this.index = new FontIndex(buffer);
  inspect(this.index.reify());
}

Font.fontFolder = ({
  win32:  '/Windows/fonts',
  darwin: '/Library/Fonts',
  linux: '/usr/share/fonts/truetype'
}[process.platform]);

Font.listFonts = function listFonts(){ return fs.readdirSync(Font.fontFolder) }
Font.load = function load(filename){
  var resolved = path._makeLong(path.resolve(Font.fontFolder, filename));
  if (exists(resolved)) {
    return new Font(fs.readFileSync(resolved), filename);
  } else {
    throw new Error(resolved + ' not found');
  }
}



// TTF Version
var TTFVersion = reified('TTFVersion', Uint8[4]);

// interceptor on reify that translates the value
TTFVersion.prototype.on('reify', function(val){
  val = val.join('');
  this.reified = val === '0100' ? 'TrueType' : val === 'OTTO' ? 'OpenType' : 'Unknown';
});


// ###############################################################################
// ### FontIndex starts the file and tells the number of Tables in the Index  ####
// ###############################################################################

var FontIndex = reified('FontIndex', {
  version    : TTFVersion,
  tableCount : Uint16,
  range      : Uint16,
  selector   : Uint16,
  shift      : Uint16
});

// On construct we can inspect the tableCount provided by FontIndex and then add in
// the Index, which is an array o
FontIndex.prototype.on('construct', function(){
  Index(this.tableCount.reify(), this);
});



// A Tag is a 4 byte string label. reified needs some built in string types

var Tag = reified('Tag', Uint32[1]);

Tag.prototype.on('reify', function(val){
  this.reified = this.buffer.asciiSlice(this.offset, this.offset+this.bytes);
});





var Table = reified('Table', {
  tag        : Tag,
  checksum   : Uint32,
  byteOffset : Uint32,
  length     : Uint32
});

// On table construct we can map the byteOffset pointer to the data location and initialize a struct on it
Table.prototype.on('construct', function(){
  var tag = this.tag.reify();
  switch (tag) {
    case 'OS/2':
      // this is a pointer, there needs to be a way to represent this
      this.table = new OS2(this.buffer, this.byteOffset.reify());
      break;
    default:
  }
});

// on reify we have to bring the values together manually due to a lack of pointer support in reified
Table.prototype.on('reify', function(){
  if (this.table) {
    this.reified.table = this.table.reify();
  }
})


// ####################################################################################
// ### The TableIndex is an array of Tables that have some basic info and a pointer ###
// ####################################################################################

function Index(tableCount, fontIndex){
  var TableIndex = reified('TableIndex', Table[tableCount]);

  TableIndex.prototype.on('reify', function(val){
    this.reified = val.reduce(function(ret, item){
      var label = labels.tables[item.tag];
      if (label) label = label.replace(/\s/g, '_');
      ret[label|| item.tag] = item;
      return ret;
    }, {});
  });

  fontIndex.constructor.names.push('tables');
  fontIndex.constructor.offsets.tables = fontIndex.bytes;
  fontIndex.tables = new TableIndex(fontIndex.buffer, fontIndex.bytes);
  fontIndex.bytes = fontIndex.constructor.bytes = fontIndex.bytes + fontIndex.tables.bytes;
}





// #######################################################################
// ### PANOSE is a set of 10 bitfields whose mapping is in labels.json ###
// #######################################################################

Object.keys(labels.panose).forEach(function(label){
  labels.panose[label] = reified(label, labels.panose[label], 1);
});
var PANOSE = reified('PANOSE', labels.panose);


// ########################################################################################
// ### Unicode pages are 4 bitfields mapping to blocks which map to ranges, labels.json ###
// ########################################################################################

var UnicodePages = reified('UnicodePages', labels.unicodeBlocks.reduce(function(ret, blocks, index){
  ret[index] = reified('UnicodePages'+index, blocks, 4);
  ret[index].prototype.on('reify', function(val){
    this.reified = flatten(val.map(function(s){
      return s.split(',').map(function(ss){ return labels.unicodeRanges[ss] });
    }));
  });
  return ret;
}, {}));

UnicodePages.prototype.on('reify', function(val){
  this.reified = flatten(Object.keys(val).map(function(s){ return val[s] })).filter(Boolean);
});


var Point = reified('Point', {
  x: Int16,
  y: Int16
});

var Metrics = reified('Metrics', {
  size: Point,
  position: Point
});

var LongDateTime = reified('LongDateTime', {
  lo: Uint32,
  hi: Uint32
});


// ##################################################################################
// ### OS2 is the 'compatability' table containing a lot of useful stats and info ###
// ##################################################################################

var OS2 = reified('OS2', {
  version      : Uint16,
  avgCharWidth : Int16,
  weightClass  : Uint16,
  widthClass   : Uint16,
  typer        : Uint16,
  subscript    : Metrics,
  superscript  : Metrics,
  strikeout    : reified('Strikeout',
  { size         : Int16,
    position     : Int16 }),
  class        : Int8[2],
  panose       : PANOSE,
  unicodePages : UnicodePages,
  vendorID     : Tag,
  selection    : Uint16,
  firstChar    : Uint16,
  lastChar     : Uint16,
  typographic  : reified('Typographic',
  { ascender     : Int16,
    descender    : Int16,
    lineGap      : Int16 }),
  winTypograph : reified('WindowsTypographic',
  { ascender     : Uint16,
    descender    : Uint16 }),
  codePages1   : reified('CodePages1', labels.codePageNames[0], 4),
  codePages2   : reified('CodePages2', labels.codePageNames[1], 4),
  xHeight      : Int16,
  capHeight    : Int16,
  defaultChar  : Uint16,
  breakChar    : Uint16,
  maxContext   : Uint16
});

OS2.prototype.on('reify', function(val){
  val.weightClass = labels.weights[val.weightClass / 100 - 1];
  val.widthClass = labels.widths[val.widthClass - 1];
  val.vendorID in vendors && (val.vendorID = vendors[val.vendorID]);
});





// TODO Head, name indexes, etc.

var Version = reified('Version', 'Uint8[4]');

var Head = reified('Head', {
  version          : Version,
  fontRevision     : Int32 ,
  checkSumAdj      : Uint32,
  magicNumber      : Uint32,
  flags            : Uint16,
  unitsPerEm       : Uint16,
  created          : LongDateTime,
  modified         : LongDateTime,
  min              : Point,
  max              : Point,
  macStyle         : Uint16,
  lowestRecPPEM    : Uint16,
  fontDirHint      : Int16,
  indexToLocFormat : Int16,
  glyphDataFormat  : Int16,
});

var NameIndex = reified('NameIndex', {
  format     : Uint16,
  length     : Uint16,
  byteOffset : Uint16
});

var NameRecord = reified('NameRecord', {
  platformID : Uint16,
  encodingID : Uint16,
  languageID : Uint16,
  nameID     : Uint16,
  length     : Uint16,
  byteOffset : Uint16,
});


//console.log(Font.listFonts());
Font.load('DejaVuSansMono.ttf');