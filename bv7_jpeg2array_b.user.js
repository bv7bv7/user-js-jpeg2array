// ==UserScript==
// @name         bv7_jpeg2array_b
// @namespace    bv7
// @version      0.2
// @description  jpeg -> array
// @author       bv7
// @grant        GM_xmlhttpRequest
// ==/UserScript==

class BaseImage {
	load(url, onload) {
		GM_xmlhttpRequest({
			method          : 'GET',
			url             : this.nodesCaptchaImgs[iImg].src,
			overrideMimeType: 'text/plain; charset=x-user-defined',
			onload          : (v) => {
				this.data = v.responseText;
				this.seek(0);
				if (onload) onload(v);
			}
		});		
	}
	seek(iData = 0) {
		this.iData = iData;
	}
	readUint8() {
		return this.iData < this.data.length ? this.data.charCodeAt(this.iData++) && 0xff : 0;
	}
	readUint16() {
		return (this.readUint8() << 8) | this.readUint8();
	}
}


class JpegImage extends BaseImage {
	constructor() {
		this.dctZigZag = new Int32Array([
			 0,
			 1,  8,
			16,  9,  2,
			 3, 10, 17, 24,
			32, 25, 18, 11, 4,
			 5, 12, 19, 26, 33, 40,
			48, 41, 34, 27, 20, 13,  6,
			 7, 14, 21, 28, 35, 42, 49, 56,
			57, 50, 43, 36, 29, 22, 15,
			23, 30, 37, 44, 51, 58,
			59, 52, 45, 38, 31,
			39, 46, 53, 60,
			61, 54, 47,
			55, 62,
			63
		]);
		this.dctCos1  =  4017   // cos(pi/16)
		this.dctSin1  =   799   // sin(pi/16)
		this.dctCos3  =  3406   // cos(3*pi/16)
		this.dctSin3  =  2276   // sin(3*pi/16)
		this.dctCos6  =  1567   // cos(6*pi/16)
		this.dctSin6  =  3784   // sin(6*pi/16)
		this.dctSqrt2 =  5793   // sqrt(2)
		this.dctSqrt1d2 = 2896  // sqrt(2) / 2
	}
	readDataBlock() {
		value = new Array(this.readUint16() - 2);
		value.forEach((v, i) => value[i] = this.readUint8());
		return value;
	}
	prepareComponents(frame) {
		frame.maxH = 0;
		frame.maxV = 0;
		frame.componentsOrder.forEach((v) => {
			let component = frame.components[v];
			if (frame.maxH < component.h) frame.maxH = component.h;
			if (frame.maxV < component.v) frame.maxV = component.v;
		});
		frame.mcusPerLine   = Math.ceil(frame.samplesPerLine / 8 / maxH);
		frame.mcusPerColumn = Math.ceil(frame.scanLines      / 8 / maxV);
		frame.componentsOrder.forEach((v) => {
			let component = frame.components[v];
            component.blocksPerLine   = Math.ceil(Math.ceil(frame.samplesPerLine / 8) * component.h / maxH);
            component.blocksPerColumn = Math.ceil(Math.ceil(frame.scanLines      / 8) * component.v / maxV);
			component.blocks          = [];
			let blocksPerLineForMcu   = mcusPerLine   * component.h;
			let blocksPerColumnForMcu = mcusPerColumn * component.v;
			for (let i = 0; i < blocksPerColumnForMcu; i++) {
				let row = [];
				for (let j = 0; j < blocksPerLineForMcu; j++) row.push(new Int32Array(64));
				component.blocks.push(row);
            }
		});
	}
	parse() {
		this.jfif  = null;
		this.adobe = null;
		let quantizationTables = [];
		let frames             = [];
		let frame = null;
		this.seek(0);
		let fileMarker = readUint16();
		if (fileMarker != 0xFFD8) { // SOI (Start of Image)
			console.log('JpegImage: Error: SOI not found');
			return;
		}
		while ((fileMarker = readUint16()) != 0xFFD9) { // EOI (End of image)
			switch(fileMarker) {
				case 0xFF00: break;
				case 0xFFE0: // APP0 (Application Specific)
				case 0xFFE1: // APP1
				case 0xFFE2: // APP2
				case 0xFFE3: // APP3
				case 0xFFE4: // APP4
				case 0xFFE5: // APP5
				case 0xFFE6: // APP6
				case 0xFFE7: // APP7
				case 0xFFE8: // APP8
				case 0xFFE9: // APP9
				case 0xFFEA: // APP10
				case 0xFFEB: // APP11
				case 0xFFEC: // APP12
				case 0xFFED: // APP13
				case 0xFFEE: // APP14
				case 0xFFEF: // APP15
				case 0xFFFE: // COM (Comment)
					let appData = this.readDataBlock();
					switch(fileMarker){
						case 0xFFE0:
							if (
								appData[0] === 0x4A &&
								appData[1] === 0x46 &&
								appData[2] === 0x49 &&
								appData[3] === 0x46 &&
								appData[4] === 0
							) this.jfif = { // 'JFIF\x00'
								version     : { major: appData[5], minor: appData[6] },
								densityUnits: appData[7],
								xDensity    : (appData[8 ] << 8) | appData[9 ],
								yDensity    : (appData[10] << 8) | appData[11],
								thumbWidth  : appData[12],
								thumbHeight : appData[13],
								thumbData   : appData.slice(14, 14 + 3 * appData[12] * appData[13])
							};
							break;
						// TODO APP1 - Exif
						case 0xFFEE:
							if (
								appData[0] === 0x41 &&
								appData[1] === 0x64 &&
								appData[2] === 0x6F &&
								appData[3] === 0x62 &&
								appData[4] === 0x65 &&
								appData[5] === 0
							) this.adobe = { // 'Adobe\x00'
								version      : appData[6],
								flags0       : (appData[7] << 8) | appData[8],
								flags1       : (appData[9] << 8) | appData[10],
								transformCode: appData[11]
							};
							break;
					}
					break;
				case 0xFFDB: // DQT (Define Quantization Tables)
					for(let quantizationTablesLength = this.readUint16() - 2; quantizationTablesLength > 0; quantizationTablesLength--) {
						let quantizationTableSpec = this.readUint8();
						let tableData = new Int32Array(64);
						switch(quantizationTableSpec >> 4){
							case 0: // 8 bit values
									tableData.forEach((v, i) => tableData[this.dctZigZag[i]] = this.readUint8());
								break;
							case 1: //16 bit
									tableData.forEach((v, i) => tableData[this.dctZigZag[i]] = this.readUint16());
								break;
							default:
								console.log('JpegImage: Error: DQT: invalid table spec');
								return;
						}
						quantizationTables[quantizationTableSpec & 15] = tableData;
					}
					break;
				case 0xFFC0: // SOF0 (Start of Frame, Baseline DCT)
				case 0xFFC1: // SOF1 (Start of Frame, Extended DCT)
				case 0xFFC2: // SOF2 (Start of Frame, Progressive DCT)
					this.readUint16(); // skip data length
					frame = {
						extended       : fileMarker === 0xFFC1,
						progressive    : fileMarker === 0xFFC2,
						precision      : this.readUint8(),
						scanLines      : this.readUint16(),
						samplesPerLine : this.readUint16(),
						components     : {},
						componentsOrder: new Array(this.readUint8())
					};
					frame.componentsOrder.forEach((v, i) => {
						let componentId = this.readUint8();
						let b           = this.readUint8();
						frame.componentsOrder[i] = componentId;
						frame.components[componentId] = {
							h              : b >> 4,
							v              : b & 15,
							quantizationIdx: this.readUint8()
						};
					});
					this.prepareComponents(frame);
					frames.push(frame);
					break;
				case 0xFFC4: // DHT (Define Huffman Tables)
				case 0xFFDD: // DRI (Define Restart Interval)
				case 0xFFDA: // SOS (Start of Scan)
				case 0xFFFF: // Fill bytes
				default:
			}
		}
	}
	
	
	parse: function parse(data) {
      var offset = 0, length = data.length;
      function readUint16() {
        var value = (data[offset] << 8) | data[offset + 1];
        offset += 2;
        return value;
      }
      function readDataBlock() {
        var length = readUint16();
        var array = data.subarray(offset, offset + length - 2);
        offset += array.length;
        return array;
      }
      function prepareComponents(frame) {
        var maxH = 0, maxV = 0;
        var component, componentId;
        for (componentId in frame.components) {
          if (frame.components.hasOwnProperty(componentId)) {
            component = frame.components[componentId];
            if (maxH < component.h) maxH = component.h;
            if (maxV < component.v) maxV = component.v;
          }
        }
        var mcusPerLine = Math.ceil(frame.samplesPerLine / 8 / maxH);
        var mcusPerColumn = Math.ceil(frame.scanLines / 8 / maxV);
        for (componentId in frame.components) {
          if (frame.components.hasOwnProperty(componentId)) {
            component = frame.components[componentId];
            var blocksPerLine = Math.ceil(Math.ceil(frame.samplesPerLine / 8) * component.h / maxH);
            var blocksPerColumn = Math.ceil(Math.ceil(frame.scanLines  / 8) * component.v / maxV);
            var blocksPerLineForMcu = mcusPerLine * component.h;
            var blocksPerColumnForMcu = mcusPerColumn * component.v;
            var blocks = [];
            for (var i = 0; i < blocksPerColumnForMcu; i++) {
              var row = [];
              for (var j = 0; j < blocksPerLineForMcu; j++)
                row.push(new Int32Array(64));
              blocks.push(row);
            }
            component.blocksPerLine = blocksPerLine;
            component.blocksPerColumn = blocksPerColumn;
            component.blocks = blocks;
          }
        }
        frame.maxH = maxH;
        frame.maxV = maxV;
        frame.mcusPerLine = mcusPerLine;
        frame.mcusPerColumn = mcusPerColumn;
      }
      var jfif = null;
      var adobe = null;
      var pixels = null;
      var frame, resetInterval;
      var quantizationTables = [], frames = [];
      var huffmanTablesAC = [], huffmanTablesDC = [];
      var fileMarker = readUint16();
      if (fileMarker != 0xFFD8) { // SOI (Start of Image)
        throw new Error("SOI not found");
      }

      fileMarker = readUint16();
      while (fileMarker != 0xFFD9) { // EOI (End of image)
        var i, j, l;
        switch(fileMarker) {
          case 0xFF00: break;
          case 0xFFE0: // APP0 (Application Specific)
          case 0xFFE1: // APP1
          case 0xFFE2: // APP2
          case 0xFFE3: // APP3
          case 0xFFE4: // APP4
          case 0xFFE5: // APP5
          case 0xFFE6: // APP6
          case 0xFFE7: // APP7
          case 0xFFE8: // APP8
          case 0xFFE9: // APP9
          case 0xFFEA: // APP10
          case 0xFFEB: // APP11
          case 0xFFEC: // APP12
          case 0xFFED: // APP13
          case 0xFFEE: // APP14
          case 0xFFEF: // APP15
          case 0xFFFE: // COM (Comment)
            var appData = readDataBlock();

            if (fileMarker === 0xFFE0) {
              if (appData[0] === 0x4A && appData[1] === 0x46 && appData[2] === 0x49 &&
                appData[3] === 0x46 && appData[4] === 0) { // 'JFIF\x00'
                jfif = {
                  version: { major: appData[5], minor: appData[6] },
                  densityUnits: appData[7],
                  xDensity: (appData[8] << 8) | appData[9],
                  yDensity: (appData[10] << 8) | appData[11],
                  thumbWidth: appData[12],
                  thumbHeight: appData[13],
                  thumbData: appData.subarray(14, 14 + 3 * appData[12] * appData[13])
                };
              }
            }
            // TODO APP1 - Exif
            if (fileMarker === 0xFFEE) {
              if (appData[0] === 0x41 && appData[1] === 0x64 && appData[2] === 0x6F &&
                appData[3] === 0x62 && appData[4] === 0x65 && appData[5] === 0) { // 'Adobe\x00'
                adobe = {
                  version: appData[6],
                  flags0: (appData[7] << 8) | appData[8],
                  flags1: (appData[9] << 8) | appData[10],
                  transformCode: appData[11]
                };
              }
            }
            break;

          case 0xFFDB: // DQT (Define Quantization Tables)
            var quantizationTablesLength = readUint16();
            var quantizationTablesEnd = quantizationTablesLength + offset - 2;
            while (offset < quantizationTablesEnd) {
              var quantizationTableSpec = data[offset++];
              var tableData = new Int32Array(64);
              if ((quantizationTableSpec >> 4) === 0) { // 8 bit values
                for (j = 0; j < 64; j++) {
                  var z = dctZigZag[j];
                  tableData[z] = data[offset++];
                }
              } else if ((quantizationTableSpec >> 4) === 1) { //16 bit
                for (j = 0; j < 64; j++) {
                  var z = dctZigZag[j];
                  tableData[z] = readUint16();
                }
              } else
                throw new Error("DQT: invalid table spec");
              quantizationTables[quantizationTableSpec & 15] = tableData;
            }
            break;

          case 0xFFC0: // SOF0 (Start of Frame, Baseline DCT)
          case 0xFFC1: // SOF1 (Start of Frame, Extended DCT)
          case 0xFFC2: // SOF2 (Start of Frame, Progressive DCT)
            readUint16(); // skip data length
            frame = {};
            frame.extended = (fileMarker === 0xFFC1);
            frame.progressive = (fileMarker === 0xFFC2);
            frame.precision = data[offset++];
            frame.scanLines = readUint16();
            frame.samplesPerLine = readUint16();
            frame.components = {};
            frame.componentsOrder = [];
            var componentsCount = data[offset++], componentId;
            var maxH = 0, maxV = 0;
            for (i = 0; i < componentsCount; i++) {
              componentId = data[offset];
              var h = data[offset + 1] >> 4;
              var v = data[offset + 1] & 15;
              var qId = data[offset + 2];
              frame.componentsOrder.push(componentId);
              frame.components[componentId] = {
                h: h,
                v: v,
                quantizationIdx: qId
              };
              offset += 3;
            }
            prepareComponents(frame);
            frames.push(frame);
            break;

          case 0xFFC4: // DHT (Define Huffman Tables)
            var huffmanLength = readUint16();
            for (i = 2; i < huffmanLength;) {
              var huffmanTableSpec = data[offset++];
              var codeLengths = new Uint8Array(16);
              var codeLengthSum = 0;
              for (j = 0; j < 16; j++, offset++)
                codeLengthSum += (codeLengths[j] = data[offset]);
              var huffmanValues = new Uint8Array(codeLengthSum);
              for (j = 0; j < codeLengthSum; j++, offset++)
                huffmanValues[j] = data[offset];
              i += 17 + codeLengthSum;

              ((huffmanTableSpec >> 4) === 0 ?
                huffmanTablesDC : huffmanTablesAC)[huffmanTableSpec & 15] =
                buildHuffmanTable(codeLengths, huffmanValues);
            }
            break;

          case 0xFFDD: // DRI (Define Restart Interval)
            readUint16(); // skip data length
            resetInterval = readUint16();
            break;

          case 0xFFDA: // SOS (Start of Scan)
            var scanLength = readUint16();
            var selectorsCount = data[offset++];
            var components = [], component;
            for (i = 0; i < selectorsCount; i++) {
              component = frame.components[data[offset++]];
              var tableSpec = data[offset++];
              component.huffmanTableDC = huffmanTablesDC[tableSpec >> 4];
              component.huffmanTableAC = huffmanTablesAC[tableSpec & 15];
              components.push(component);
            }
            var spectralStart = data[offset++];
            var spectralEnd = data[offset++];
            var successiveApproximation = data[offset++];
            var processed = decodeScan(data, offset,
              frame, components, resetInterval,
              spectralStart, spectralEnd,
              successiveApproximation >> 4, successiveApproximation & 15);
            offset += processed;
            break;

          case 0xFFFF: // Fill bytes
            if (data[offset] !== 0xFF) { // Avoid skipping a valid marker.
              offset--;
            }
            break;

          default:
            if (data[offset - 3] == 0xFF &&
                data[offset - 2] >= 0xC0 && data[offset - 2] <= 0xFE) {
              // could be incorrect encoding -- last 0xFF byte of the previous
              // block was eaten by the encoder
              offset -= 3;
              break;
            }
            throw new Error("unknown JPEG marker " + fileMarker.toString(16));
        }
        fileMarker = readUint16();
      }
      if (frames.length != 1)
        throw new Error("only single frame JPEGs supported");

      // set each frame's components quantization table
      for (var i = 0; i < frames.length; i++) {
        var cp = frames[i].components;
        for (var j in cp) {
          cp[j].quantizationTable = quantizationTables[cp[j].quantizationIdx];
          delete cp[j].quantizationIdx;
        }
      }

      this.width = frame.samplesPerLine;
      this.height = frame.scanLines;
      this.jfif = jfif;
      this.adobe = adobe;
      this.components = [];
      for (var i = 0; i < frame.componentsOrder.length; i++) {
        var component = frame.components[frame.componentsOrder[i]];
        this.components.push({
          lines: buildComponentData(frame, component),
          scaleX: component.h / frame.maxH,
          scaleY: component.v / frame.maxV
        });
      }
    },

	
	
	
}

class Jpeg {
	decode(jpegData) {
		
	}
}

jpeg = new Jpeg();
