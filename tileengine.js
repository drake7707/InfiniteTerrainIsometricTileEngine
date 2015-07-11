"use strict";

var stop = false;
var fullOnly = false;
var dynamicFPS = false;
var fuzzyTransition = true;

// allow creation of diamond square canvasses for debugging purposes (disabling this will speed things up a little, but you won't be able to see the height maps)
var generateDiamondSquareCanvasses = true;

// current zoom factor
var zoom = 0.3;

var NR_OF_TILES = 8;
var TILESET_ITEMS_PER_ROW = 3;

// tile width & height (pixels)
var TILE_WIDTH = 50;
var TILE_HEIGHT = 33;

/*
  Note: I started the board off with only a single 2d layer, width x height. Afterwards I added the 3d 'height', I didn't want to rename
  all the original height variables so I used depth to determine the 3rd dimension. Usually it would be  X and Z (width & depth) for each
  layer, and Y for the height, but in this case Y and Z are swapped in names.

  So in essence:

                       | Z (depth)
                       |
                       |
                     /   \
                   /       \
      Y (height) /           \  X (width)
*/

// the offset when advancing 1 tile on the X axis
var DELTAX_X = 25;
var DELTAX_Y = 12;

// the offset when advancing 1 tile on the Y axis
var DELTAY_X = -25;
var DELTAY_Y = 12;

// the offset when advancing 1 tile on the Z axis
var DELTAZ_X = 0;
var DELTAZ_Y = -8;

var SCROLL_SPEED = 5;

var frameSkip = 0;

var tileset;
var tileshadow;

// the dimensions of each chunk
var boardWidth = 8;
var boardHeight = 8;
var boardDepth = 16;

var chunks = [];
var chunksOnRow = 4;

var loadedChunks = {};

var tileStorage = new TileMergeStorage();

var screenOffset = {
    x: 0,
    y: 0
};


var stats = {
    nrOfTilesDrawn: 0,
    nrOfChunksVisible: 0,
    drawIncrementalMs: 0,
    nrOfChunksLoaded: 0,
    nrOfChunksRemoved: 0,

    reset: function () {
        this.nrOfTilesDrawn = 0;
        this.nrOfChunksVisible = 0;
        this.drawIncrementalMs = 0;
        this.nrOfChunksLoaded = 0;
        this.nrOfChunksRemoved = 0;
    }
};

var heightResolution = 1;
var biomeResolution = 1;

var heightMap = new DiamondSquare(129, 0.5);
var biomeMap = heightMap; //new DiamondSquare(129);

var viewportBounds;

var scr;
var ctx;
var buffer;
var ctxBuffer;

$(window).resize(function () {
    initCanvas();
});

$(window).keydown(function (ev) {
    if (ev.keyCode == 70) { // f
        fuzzyTransition = !fuzzyTransition;
        drawFull(ctx, chunks);
    }
    else if (ev.keyCode == 32) {  // space
        stop = !stop;
        if (!stop)
            update();
    }
    else if (ev.keyCode == 84) { // t
        $("#fuzzyTilesetContainer").toggle();
    }
    else if (ev.keyCode == 72) { // h
        $(".textOverlay").toggle();
    }
    else if (ev.keyCode == 68) { // d
        $("#terrain").toggle();
    }
    else if (ev.keyCode == 82) { // r
        drawFull(ctx, chunks);
    }
    else if (ev.keyCode == 38) { // up
        var oldZoom = zoom;
        zoom -= 0.1;
        if (zoom < 0.1)
            zoom = 0.1;
        if (oldZoom != zoom)
            drawFull(ctx, chunks);
    }
    else if (ev.keyCode == 40) { // down
        var oldZoom = zoom;
        zoom += 0.1;
        if (zoom > 4)
            zoom = 4;
        if (oldZoom != zoom)
            drawFull(ctx, chunks);
    }
});

/// <summary>
/// Initializes the canvas and buffer for the screen
/// </summary>
function initCanvas() {

    scr.width = $(window).width();
    scr.height = $(window).height();
    buffer.width = scr.width;
    buffer.height = scr.height;

    viewportBounds = getViewPortBounds();

    // load all chunks in range of the viewport
    var chunksLoaded = true;
    while (chunksLoaded)
        chunksLoaded = checkLoadChunks();

    // draw full once
    drawFull(ctx, chunks);
}

$(window).load(function () {

    // ensure yield
    window.setTimeout(function () {
        tileset = $("#tileset").get(0);
        tileshadow = $("#tileshadow").get(0);

        $("#menu").click(function () {
            $(this).fadeOut();
        });

        $("#picScreen").click(function () {
            stop = !stop;
            if (!stop)
                update();
        });

        scr = $("#picScreen").get(0);
        ctx = scr.getContext("2d");

        buffer = document.createElement('canvas');
        buffer.width = scr.width;
        buffer.height = scr.height;
        ctxBuffer = buffer.getContext("2d");

        screenOffset = {
            x: Math.floor(scr.width / 2),
            y: 0
        };

        loadChunk(0, 0);
        initCanvas();

        $("#menu").fadeOut(1000);

        update();
    }, 10);
});


var screenDelta = { x: 0, y: 0 };

var oldTime;
function update() {

    var curTime = new Date();
    var alphaTime = ((20 + curTime.getMinutes() + 15)) / 60;
    var angle = alphaTime * 3.14 * 2;

    screenDelta.x = Math.floor(Math.cos(angle) * SCROLL_SPEED);
    screenDelta.y = Math.floor(Math.sin(angle) * SCROLL_SPEED);

    // ensure dx and dy are integer when multiplied with zoom, otherwise it will be offpixel, creating major slowdown and
    // washed out effect in chrome
    screenDelta.x = Math.ceil(Math.abs(screenDelta.x) * zoom) / zoom * (screenDelta.x < 0 ? -1 : 1);
    screenDelta.y = Math.ceil(Math.abs(screenDelta.y) * zoom) / zoom * (screenDelta.y < 0 ? -1 : 1)

    screenOffset.x += screenDelta.x;
    screenOffset.y += screenDelta.y;

    // update the viewport bounds
    viewportBounds = getViewPortBounds();

    // check for chunks that can be unloaded
    checkOffscreenChunks();
    // check for chunks that need to be loaded
    checkLoadChunks();

    var beforeDrawTime = new Date().getTime();

    if (!dynamicFPS || oldTime === undefined || beforeDrawTime - oldTime > frameSkip * 10) {

        if (fullOnly)
            drawFull(ctx, chunks);
        else {
            timeFunction("drawIncremental", function () {
                drawIncremental(ctx, chunks);
            });
        }

        var afterUpdateTime = new Date().getTime();
        if (dynamicFPS) {
            var ms = afterUpdateTime - curTime.getTime();
            frameSkip = ms / 10 - 1;
            if (frameSkip < 0)
                frameSkip = 0;
            else if (frameSkip > 10)
                frameSkip = 10;
        }

        oldTime = new Date().getTime();
    }

    // update the stats label
    $("#lblDebug").html("# tiles drawn: " + stats.nrOfTilesDrawn + "<br/>" +
                        "# chunks visible: " + stats.nrOfChunksVisible + "<br/>" +
                        "# chunks loaded: " + stats.nrOfChunksLoaded + "<br/>" +
                        "# chunks removed: " + stats.nrOfChunksRemoved + "<br/>" +
                        "draw ms: " + stats.drawIncrementalMs + " (fps: " + Math.round(1000 / stats.drawIncrementalMs) + ")" + "<br/>" +
                        "");
    stats.reset();

    if (!stop)
        window.requestAnimationFrame(update);

}

/// <summary>
/// Converts the rectangle to screen coordinates
/// </summary>
/// <returns>The transformed rectangle in screen coordinates</returns>
function toViewPort(rect) {
    moveRect(rect, screenOffset.x, screenOffset.y);
    scaleRect(rect, zoom);
    return rect;
}

/// <summary>
/// Converts the rectangle to world coordinates
/// </summary>
/// <returns>The transformed rectangle in world coordinates</returns>
function toWorld(rect) {
    scaleRect(rect, 1 / zoom);
    moveRect(rect, -screenOffset.x, -screenOffset.y);
    return rect;
}

/// <summary>
/// Gets the viewport bounds in world coordinates
/// </summary>
/// <returns>A rectangle representing the viewport bounds in world coordinates</returns>
function getViewPortBounds() {
    var r = newRect(0, 0, scr.width, scr.height);
    return toWorld(r);
}

/// <summary>
/// Check if chunks can be unloaded
/// </summary>
function checkOffscreenChunks() {

    var chunkArray = new Array();
    for (var i = 0; i < chunks.length; i++) {
        var ch = chunks[i];
        if (ch !== undefined) {
            // check if the loaded chunk still intersects with the viewport
            if (intersectRect(viewportBounds, ch.bounds)) {
                chunkArray.push(chunks[i]);
            } else {
                delete loadedChunks[ch.xOffset + ";" + ch.yOffset];
                stats.nrOfChunksRemoved++;
                //console.log("Removed chunk : " + chunks[i].xOffset + "," + chunks[i].yOffset);
            }
        }
    }
    chunks = chunkArray;
}

/// <summary>
/// Check if chunks need to be loaded
/// </summary>
/// <returns>True if chunks were loaded, otherwise false</returns>
function checkLoadChunks() {

    var didLoadChunks = false;
    var curChunks = chunks.slice(0);
    for (var c = 0; c < curChunks.length; c++) {
        var ch = curChunks[c];

        // check around each loaded chunk
        for (var j = -1; j <= 1; j++) {
            for (var i = -1; i <= 1; i++) {

                var idx = (ch.xOffset + i) + ";" + (ch.yOffset + j);
                if (loadedChunks[idx] === undefined) { // the chunk at the current position is not loaded
                    // get its boundaries
                    var bounds = getBoundsOfChunk(ch.xOffset + i, ch.yOffset + j);

                    // and check if it intersects with the viewport
                    if (intersectRect(viewportBounds, bounds)) {
                        loadChunk(ch.xOffset + i, ch.yOffset + j);
                        didLoadChunks = true;
                    }
                }
            }
        }
    }

    return didLoadChunks;
}

/// <summary>
/// Loads a chunk at the given offset
/// </summary>
/// <param name='xOffset'>The X offset of the chunk</param>
/// <param name='yOffset'>The Y offset of the chunk</param>
function loadChunk(xOffset, yOffset) {
    var ch = new Chunk(xOffset, yOffset,
                       boardWidth, boardHeight, boardDepth);
    //console.log("Loading chunk " + xOffset + "," + yOffset);
    loadedChunks[ch.xOffset + ";" + ch.yOffset] = ch;
    chunks.push(ch);

    // fill the chunk data
    ch.randomize();

    // update the sides
    ch.updateSidesOfCells(chunks);

    // update the tiles around the loaded chunk
    updateSurroundingChunkSides(ch);
    stats.nrOfChunksLoaded++;
}

/// <summary>
/// Updates all the neighbour data of the adjacent tiles of the given chunk
/// </summary>
/// <param name='ch'>The chunk to update its adjacent tiles for</param>
function updateSurroundingChunkSides(ch) {
    var idx;
    var neighbourChunk;
    idx = (ch.xOffset + 1) + ";" + (ch.yOffset + 0);
    neighbourChunk = loadedChunks[idx];
    if (neighbourChunk !== undefined) // right chunk is loaded
        neighbourChunk.updateSidesOfCells(chunks, true);

    idx = (ch.xOffset + 0) + ";" + (ch.yOffset + 1);
    neighbourChunk = loadedChunks[idx];
    if (neighbourChunk !== undefined)  // bottom chunk is loaded
        neighbourChunk.updateSidesOfCells(chunks, true);

    idx = (ch.xOffset - 1) + ";" + (ch.yOffset + 0);
    neighbourChunk = loadedChunks[idx];
    if (neighbourChunk !== undefined) // left chunk is loaded
        neighbourChunk.updateSidesOfCells(chunks, true);


    idx = (ch.xOffset + 0) + ";" + (ch.yOffset - 1);
    neighbourChunk = loadedChunks[idx];
    if (neighbourChunk !== undefined)  // bottom chunk is loaded
        neighbourChunk.updateSidesOfCells(chunks, true);

}

/// <summary>
/// Creates a chunk that contains tiles at given position and with given dimensions
/// </summary>
/// <param name='xOffset'>The X offset of the chunk</param>
/// <param name='yOffset'>The Y offset of the chunk</param>
/// <param name='w'>The width of the chunk</param>
/// <param name='h'>The height of the chunk</param>
/// <param name='d'>The depth of the chunk</param>
function Chunk(xOffset, yOffset, w, h, d) {

    var self = this;
    this.xOffset = xOffset;
    this.yOffset = yOffset;

    this.cells = initArray(d, h, w);
    this.sidesOfCells = initArray(d, h, w);

    this.randomize = randomize;

    /// <summary>
    /// Fill the data of the chunk with the random data
    /// </summary>
    function randomize() {

        var maxHeight = -99;
        var minHeight = 99;

        var xOffsetTileWidth = xOffset * boardWidth;
        var yOffsetTileWidth = yOffset * boardHeight;

        for (var i = 0; i < boardWidth; i++) {
            for (var j = 0; j < boardHeight; j++) {

                // look up the value from the height map and biome map
                var heightVal = Math.floor(1 + heightMap.getValue(Math.floor((xOffsetTileWidth + i) / heightResolution), Math.floor((yOffsetTileWidth + j) / heightResolution)) * (boardDepth - 1));
                var biome = NR_OF_TILES - 1 - Math.floor(biomeMap.getValue(Math.floor((xOffsetTileWidth + i) / biomeResolution), Math.floor((yOffsetTileWidth + j) / biomeResolution)) * (NR_OF_TILES - 1));

                minHeight = 0;
                if (maxHeight < heightVal) maxHeight = heightVal;

                // if the height value is smaller than half the total layers, create 'water'
                if (heightVal < boardDepth / 4) {
                    this.cells[Math.floor(boardDepth / 4) - 1][j][i] = NR_OF_TILES - 1;
                }
                else {
                    // set each tile to the value from the biome
                    for (var k = 0; k < heightVal; k++) {
                        this.cells[k][j][i] = biome;
                    }
                }
            }
        }

        this.actualBounds = getBoundsOfChunk(xOffset, yOffset, minHeight, maxHeight);
    }
    this.updateSidesOfCells = updateSidesOfCellsOfCurrentChunk;
    function updateSidesOfCellsOfCurrentChunk(chunks, bordersOnly) {
        updateSidesOfCells(self, chunks, bordersOnly);
    };

    /// <summary>
    /// Updates the cached neighbour data of a tile for a quick lookup
    /// </summary>
    /// <param name='ch'>The chunk that contains all the tiles to update</param>
    /// <param name='chunks'>All the loaded chunks</param>
    /// <param name='bordersOnly'>If true, update only the tiles at the border of the chunk</param>
    function updateSidesOfCells(ch, chunks, bordersOnly) {
        if (bordersOnly) {

            var adjXChunk = loadedChunks[(ch.xOffset + 1) + ";" + ch.yOffset];
            if (adjXChunk === undefined) adjXChunk = null;
            var adjYChunk = loadedChunks[ch.xOffset + ";" + (ch.yOffset + 1)];
            if (adjYChunk === undefined) adjYChunk = null;

            // for each layer
            for (var k = 0; k < boardDepth; k++) {
                var sidesOfCellsK = ch.sidesOfCells[k];

                // update the top side
                var sidesOfCellsK0 = sidesOfCellsK[0];
                for (var i = 0; i < boardWidth; i++)
                    sidesOfCellsK0[i] = getSidesVisibleFromTile(ch, i, 0, k, chunks, adjXChunk, adjYChunk);

                // update the bottom side
                var sidesOfCellsKHeight_1 = sidesOfCellsK[boardHeight - 1];
                for (var i = 0; i < boardWidth; i++)
                    sidesOfCellsKHeight_1[i] = getSidesVisibleFromTile(ch, i, boardHeight - 1, k, chunks, adjXChunk, adjYChunk);

                // update the left side
                for (var j = 0; j < boardHeight; j++)
                    sidesOfCellsK[j][0] = getSidesVisibleFromTile(ch, 0, j, k, chunks, adjXChunk, adjYChunk);

                // update the right side
                for (var j = 0; j < boardHeight; j++)
                    sidesOfCellsK[j][boardWidth - 1] = getSidesVisibleFromTile(ch, boardWidth - 1, j, k, chunks, adjXChunk, adjYChunk);

            }
        }
        else {
            // iterate over all tiles in the chunk and update the sides
            for (var k = 0; k < boardDepth; k++) {
                var sidesOfCellsK = ch.sidesOfCells[k];
                for (var j = 0; j < boardHeight; j++) {
                    var sidesOfCellsKJ = sidesOfCellsK[j];
                    for (var i = 0; i < boardWidth; i++) {
                        sidesOfCellsKJ[i] = getSidesVisibleFromTile(ch, i, j, k, chunks);
                    }
                }
            }
        }
    }

    this.bounds = getBoundsOfChunk(this.xOffset, this.yOffset);
}

/// <summary>
/// Returns the bounding box of a chunk
/// </summary>
/// <param name='xOffset'>The x coordinate of the chunk</param>
/// <param name='yOffset'>The y coordinate of the chunk</param>
/// <param name='minHeight'>The minimum height of the chunk (default: 0)</param>
/// <param name='maxHeight'>The max height of the chunk (default: boardDepth-1)</param>
/// <returns>The bounding box of a chunk</returns>
function getBoundsOfChunk(xOffset, yOffset, minHeight, maxHeight) {
    if (minHeight === undefined)
        minHeight = 0;

    if (maxHeight === undefined)
        maxHeight = boardDepth - 1;

    // determine world coordinates, and get the bounding boxes of all corners tiles, then the bounding box of all
    // those rectangles
    var left = xOffset * boardWidth;
    var top = yOffset * boardHeight;
    return getBoundingBox([
        getTargetRectOfTile(left + 0, top + 0, minHeight),
        getTargetRectOfTile(left + boardWidth - 1, top + 0, minHeight),
        getTargetRectOfTile(left + 0, top + boardHeight - 1, minHeight),
        getTargetRectOfTile(left + boardWidth - 1, top + boardHeight - 1, minHeight),
        getTargetRectOfTile(left + 0, top + 0, maxHeight),
        getTargetRectOfTile(left + boardWidth - 1, top + 0, maxHeight),
        getTargetRectOfTile(left + 0, top + boardHeight - 1, maxHeight),
        getTargetRectOfTile(left + boardWidth - 1, top + boardHeight - 1, maxHeight)
    ]);
}

/// <summary>
/// Returns the bounding box of the given rectangles
/// </summary>
/// <param name='rects'>An array of rectangles</param>
/// <returns>The bounding box rectangle of the given rectangles</returns>
function getBoundingBox(rects) {
    var r = rects[0];

    for (var i = 1; i < rects.length; i++) {
        var curR = rects[i];
        if (curR.left < r.left)
            r.left = curR.left;

        if (curR.top < r.top)
            r.top = curR.top;

        if (curR.right > r.right)
            r.right = curR.right;

        if (curR.bottom > r.bottom)
            r.bottom = curR.bottom;
    }
    return r;
}

/// <summary>
/// Creates a 3d array based on given width, height and depth
/// </summary>
/// <param name='w'>The width of the array</param>
/// <param name='h'>The height of the array</param>
/// <param name='d'>The depth of the array</param>
/// <returns>A 3d array</returns>
function initArray(w, h, d) {
    var i;
    var j;
    var k;
    var a = new Array(w);
    for (i = 0; i < w; i++) {
        var arr = new Array(h);
        a[i] = arr;
        for (j = 0; j < h; j++) {
            arr[j] = new Array(d);
        }
    }
    return a;
}

var oldScreenPos;

/// <summary>
/// Draws only the part that is modified
/// </summary>
/// <param name='ctx'>The context to draw on</param>
/// <param name='chunks'>A collection of all loaded chunks</param>
function drawIncremental(ctx, chunks) {

    // determine the offset of the entire frame
    var dx = screenOffset.x - oldScreenPos.x;
    var dy = screenOffset.y - oldScreenPos.y;

    if (dx !== 0 || dy !== 0) {

        // determine the rectangle that needs to be filled in at the left or right side of the screen
        var xrect;
        if (dx > 0)
            xrect = newRect(0, 0, dx, scr.height);
        if (dx < 0)
            xrect = newRect(scr.width + dx, 0, -dx, scr.height);

        var yrect;
        // determine the rectangle that needs to be filled in at the top or bottom side of the screen
        if (dy > 0)
            yrect = newRect(0, 0, scr.width, dy);
        else if (dy < 0)
            yrect = newRect(0, scr.height + dy, scr.width, -dy);


        if (dx != 0) {
            // determine the world coordinates of the rectangle
            xrect = toWorld(xrect);
            // draw all the chunks intersecting that rectangle  to the buffer
            drawInRect(ctxBuffer, chunks, xrect);
        }

        if (dy != 0) {
            // determine the world coordinates of the rectangle
            yrect = toWorld(yrect);
            // draw all the chunks intersecting that rectangle to the buffer
            drawInRect(ctxBuffer, chunks, yrect);
        }

        // draw the previous frame on the buffer
        ctxBuffer.drawImage(scr, 0, 0, scr.width, scr.height, 0, 0, buffer.width, buffer.height);

        // clear the canvas
        ctx.clearRect(0, 0, scr.width, scr.height);
        // draw the buffer image to the canvas
        ctx.drawImage(buffer, dx * zoom, dy * zoom);
    }

    // set the old screen position
    oldScreenPos = {
        x: screenOffset.x,
        y: screenOffset.y
    };
}

/// <summary>
/// Draws all the chunks that intersect with the given rect.
/// This is a method that is called on each frame, so it's heavily optimized
/// </summary>
/// <param name='ctx'>The context to draw on</param>
/// <param name='chunks'>A collection of all loaded chunks</param>
/// <param name='rect'>The viewport to draw in</param>
function drawInRect(ctx, chunks, rect) {
    var chunkLength = chunks.length;

    // determine which chunks intersect with the given rect
    var visibleChunks = []
    for (var c = 0; c < chunkLength; c++) {
        var ch = chunks[c];
        if (intersectRect(rect, ch.actualBounds)) {
            visibleChunks.push(ch);
            stats.nrOfChunksVisible++;
        }
    }

    var visibleChunkLength = visibleChunks.length;

    // for each height layer
    for (var z = 0; z < boardDepth; z++) {

        // iterate all the visible chunks
        for (var c = 0; c < visibleChunkLength; c++) {

            var ch = visibleChunks[c];
            var chunkOffsetX = ch.xOffset * boardWidth;
            var chunkOffsetY = ch.yOffset * boardHeight;
            // optimization, reduce array lookups
            var chsidesOfCellsZ = ch.sidesOfCells[z];
            var cellsZ = ch.cells[z];

            // 	check all the tiles of the chunk
            for (var y = 0; y < boardHeight; y++) {
                var chsidesOfCellsZY = chsidesOfCellsZ[y];
                var cellsZY = cellsZ[y];

                var targetTileY = y + chunkOffsetY;
                for (var x = 0; x < boardWidth; x++) {
                    var idx = cellsZY[x];
                    if (idx !== undefined && idx != -1) {
                        var sidesVisible = chsidesOfCellsZY[x];
                        // draw the tile if necessary
                        drawTile(ctx, idx,
                                 x + chunkOffsetX,
                                 targetTileY, z,
                                 sidesVisible, rect);
                    }
                }
            }
        }
    }
}

/// <summary>
/// Clears the screen and redraws all the visible tiles of all loaded chunks
/// </summary>
/// <param name='ctx'>The context to draw on</param>
/// <param name='chunks'>A collection of all loaded chunks</param>
function drawFull(ctx, chunks) {

    ctx.clearRect(0, 0, scr.width, scr.height);
    for (var z = 0; z < boardDepth; z++) {
        for (var c = 0; c < chunks.length; c++) {
            var ch = chunks[c];
            var chunkOffsetX = ch.xOffset * boardWidth;
            var chunkOffsetY = ch.yOffset * boardHeight;

            for (var y = 0; y < boardHeight; y++) {
                for (var x = 0; x < boardWidth; x++) {


                    var idx = ch.cells[z][y][x];
                    if (idx !== undefined && idx != -1) {
                        var sidesVisible = ch.sidesOfCells[z][y][x]; //  getSidesVisibleFromTile(ch, x, y, z, chunks);
                        drawTile(ctx, idx,
                                 x + chunkOffsetX,
                                 y + chunkOffsetY, z,
                                 sidesVisible);
                    }
                }
            }
        }
    }

    oldScreenPos = {
        x: screenOffset.x,
        y: screenOffset.y
    };
}

///<summary>
/// Returns the state of the sides of a tile
///</summary>
/// <param name='ch'>The current chunk the tile belongs to</param>
/// <param name='x'>The x coordinate of the tile to check</param>
/// <param name='y'>The y coordinate of the tile to check</param>
/// <param name='z'>The z coordinate of the tile to check</param>
/// <param name='chunks'>A collection of all loaded chunks</param>
/// <param name='adjXChunk'>The adjacent chunk on the X axis</param>
/// <param name='adjYChunk'>The adjacent chunk on the Y axis</param>
/// <returns>An object that represents the state of the X side, Y side and top side of the given tile</returns>
function getSidesVisibleFromTile(ch, x, y, z, chunks, adjXChunk, adjYChunk) {
    var sidesVisible = {
        xSide: false,
        xShadow: false,
        ySide: false,
        yShadow: false,
        topSide: true
    };

    // check if top is visible
    if (z + 1 == boardDepth || ch.cells[z + 1][y][x] === undefined)
        sidesVisible.topSide = true;
    else
        sidesVisible.topSide = false;

    // check x side
    if (x + 1 < boardWidth) {
        var neighbourValue = ch.cells[z][y][x + 1];
        sidesVisible.xSide = neighbourValue === undefined;
        sidesVisible.xSideValue = neighbourValue;

        if (z - 1 >= 0)
            sidesVisible.xShadow = ch.cells[z - 1][y][x + 1] !== undefined;
    } else {
        // the adjacent tile falls in a new chunk, check the adjacent chunk
        var adjChunk = (adjXChunk === undefined) ? loadedChunks[(ch.xOffset + 1) + ";" + ch.yOffset] : adjXChunk;
        if (adjChunk !== undefined && adjChunk != null) {
            var neighbourValue = adjChunk.cells[z][y][x + 1 - boardWidth];
            sidesVisible.xSide = (neighbourValue === undefined);
            sidesVisible.xSideValue = neighbourValue;
        } else
            sidesVisible.xSide = true;
    }

    // check y side
    if (y + 1 < boardHeight) {
        var neighbourValue = ch.cells[z][y + 1][x];
        sidesVisible.ySide = neighbourValue === undefined;
        sidesVisible.ySideValue = neighbourValue;

        if (z - 1 >= 0)
            sidesVisible.yShadow = ch.cells[z - 1][y + 1][x] !== undefined;
    } else {
        // the adjacent tile falls in a new chunk, check the adjacent chunk
        var adjChunk = (adjYChunk === undefined) ? loadedChunks[ch.xOffset + ";" + (ch.yOffset + 1)] : adjYChunk;
        if (adjChunk !== undefined && adjChunk != null) {
            var neighbourValue = adjChunk.cells[z][y + 1 - boardWidth][x];
            sidesVisible.ySide = (neighbourValue === undefined);
            sidesVisible.ySideValue = neighbourValue;
        } else
            sidesVisible.ySide = true;
    }

    return sidesVisible;
}

///<summary>
/// Returns the bounding box of a tile with given coordinates
///</summary>
/// <param name='x'>The x coordinate of the tile</param>
/// <param name='y'>The y coordinate of the tile</param>
/// <param name='z'>The z coordinate of the tile</param>
/// <returns>A rectangle that defines the position and size of the tile</returns>
function getTargetRectOfTile(x, y, z) {
    var destX = x * DELTAX_X + y * DELTAY_X + z * DELTAZ_X;
    var destY = x * DELTAX_Y + y * DELTAY_Y + z * DELTAZ_Y;

    var r = newRect(destX, destY, TILE_WIDTH, TILE_HEIGHT);
    return r;
}

///<summary>
/// Draws a tile
///</summary>
/// <param name='ctx'>The context to draw with</param>
/// <param name='idx'>The index in the tileset that represents the tile value</param>
/// <param name='x'>The x coordinate of the tile to check</param>
/// <param name='y'>The y coordinate of the tile to check</param>
/// <param name='z'>The z coordinate of the tile to check</param>
/// <param name='sideVisible'>An object that specifies which sides are visible</param>
/// <param name='insideRect'>The viewport to draw into, optional</param>
function drawTile(ctx, idx, x, y, z, sideVisible, insideRect) {
    // check if any side needs to be drawn
    var needToDraw = sideVisible.topSide || sideVisible.xSide || sideVisible.ySide;
    if (!needToDraw)
        return;

    // determine tile location
    var tileRect = getTargetRectOfTile(x, y, z);

    // check if it falls inside the specified viewport (if it is specified)
    needToDraw = insideRect === undefined || intersectRect(tileRect, insideRect);
    if (!needToDraw)
        return;

    stats.nrOfTilesDrawn++;

    // determine the screen position of the tile bounding box
    tileRect = toViewPort(tileRect);

    var srcX = (idx % TILESET_ITEMS_PER_ROW) * TILE_WIDTH;
    var srcY = Math.floor(idx / TILESET_ITEMS_PER_ROW) * TILE_HEIGHT;

    // draw top from tile storage
    if (sideVisible.topSide) {
        tileStorage.drawTile(ctx, idx, sideVisible, tileRect, srcX, srcY);
    }

    // draw x side
    if (sideVisible.xSide) {
        var srcXOffsetBorder = srcX + TILESET_ITEMS_PER_ROW * TILE_WIDTH + TILE_WIDTH / 2;
        ctx.drawImage(tileset, srcXOffsetBorder, srcY,
                      TILE_WIDTH / 2, TILE_HEIGHT,
                      tileRect.left + TILE_WIDTH * zoom / 2, tileRect.top,
                      TILE_WIDTH * zoom / 2, TILE_HEIGHT * zoom);

        // if the shadow on the x side needs to be drawn
        if (sideVisible.xShadow)
            ctx.drawImage(tileshadow, 30, 0, 30, 18,
                          tileRect.left - 5 * zoom + TILE_WIDTH * zoom / 2, tileRect.top + TILE_HEIGHT * zoom / 2 + 3 * zoom, 30 * zoom, 18 * zoom);
    }

    // draw y side
    if (sideVisible.ySide) {
        var srcXOffsetBorder = srcX + TILESET_ITEMS_PER_ROW * TILE_WIDTH;
        ctx.drawImage(tileset, srcXOffsetBorder, srcY,
                      TILE_WIDTH / 2, TILE_HEIGHT,
                      tileRect.left, tileRect.top,
                      TILE_WIDTH * zoom / 2, TILE_HEIGHT * zoom);

        // if the shadow on the y side needs to be drawn
        if (sideVisible.yShadow)
            ctx.drawImage(tileshadow, 0, 0, 30, 18,
                          tileRect.left - 5 * zoom, (tileRect.top + TILE_HEIGHT * zoom / 2 + 3 * zoom), 30 * zoom, 18 * zoom);
    }

}

/// <summary>
/// Determines if the 2 given rectangles intersect each other
/// </summary>
/// <param name='r1'>The first rectangle</param>
/// <param name='r2'>The second rectangle</param>
/// <returns>True if the given rectangles intersect</returns>
function intersectRect(r1, r2) {
    return !(r2.left > r1.right ||
             r2.right < r1.left ||
             r2.top > r1.bottom ||
             r2.bottom < r1.top);
}

/// <summary>
/// A class that generates pseudo random values using the diamond square algoritm.
/// The class lazy loads chunks based on the requested coordinates. Adjacent chunks
/// are generated seamlessy by copying the borders of the already loaded chunks as initial
/// seed for the current chunk.
/// </summary>
/// <param name='size'>The chunk size (in 2^x +1) </param>
/// <param name='rougness'>The roughness parameter of the algorithm, [0f, 1f]</param>
function DiamondSquare(size, roughness) {

    if (roughness === undefined)
        roughness = 1;

    this.size = size;
    this.getValue = getValue;

    var self = this;

    /// <summary>
    /// Returns a value generated from the diamond square algorithm at given coordinates
    /// </summary>
    /// <param name='x'>The first rectangle</param>
    /// <param name='y'>The second rectangle</param>
    /// <returns>True if the given rectangles intersect</returns>
    function getValue(x, y) {

        // determine chunk coordinates
        var srcX = Math.floor(x / size);
        var srcY = Math.floor(y / size);
        var values = self.loadedValues[srcX + ";" + srcY];
        if (values === undefined) {
            // the chunk at given coordinates is not loaded yet
            // create the initial array for the chunk
            var initialArray = getInitialArray(self.loadedValues, srcX, srcY);
            // create the values for the current chunk
            values = generateArray(initialArray, self.loadedValues, srcX, srcY, roughness);
            // save the values
            self.loadedValues[srcX + ";" + srcY] = values;

            // if canvasses need to be created (for debugging purposes)
            // create a canvas for each chunk and append it to the terrain
            if (generateDiamondSquareCanvasses) {
                var canvas = createTerrainCanvas(srcX, srcY, size, values);
                $("#terrain").append(canvas);
                var children = $("#terrain").children();

                // determine the lower x & y bounds of the canvasses already present
                var mostNegLeft = 0;
                var mostNegTop = 0;
                for (var ch = 0; ch < children.length; ch++) {
                    var off = $(children[ch]).position();
                    if (mostNegLeft > off.left)
                        mostNegLeft = off.left;

                    if (mostNegTop > off.top)
                        mostNegTop = off.top;
                }
                // shift the terrain to match those lower bounds so the screen offset is 0,0
                $("#terrain").css({ left: -mostNegLeft + "px", top: -mostNegTop + "px" });
            }
        }
        // determine the x & y coordinates within the current chunk
        var arrX = (x + (1 + Math.floor(Math.abs(x / size))) * size) % size;
        var arrY = (y + (1 + Math.floor(Math.abs(y / size))) * size) % size;
        return values[arrX][arrY];
    };

    this.loadedValues = {};

    /// <summary>
    /// Creates an initial array for a chunk
    /// </summary>
    /// <param name='loadedValues'>The chunks already loaded</param>
    /// <param name='srcX'>The x coordinate of the chunk</param>
    /// <param name='srcY'>The y coordinate of the chunk</param>
    /// <returns>An initial array for a new chunk</returns>
    function getInitialArray(loadedValues, srcX, srcY) {

        // allocate a new array for the chunk
        var values = new Array(size);
        for (var i = 0; i < size; i++) {
            values[i] = new Array(size);
        }

        // if the left chunk is loaded, copy its right side
        if (loadedValues[(srcX - 1) + ";" + (srcY)] !== undefined) {
            var prevValues = loadedValues[(srcX - 1) + ";" + (srcY)];
            // left side
            for (var i = 0; i < size; i++)
                values[0][i] = prevValues[size - 1][i];
        }

        // if the right chunk is loaded, copy its left side
        if (loadedValues[(srcX + 1) + ";" + (srcY)] !== undefined) {
            var prevValues = loadedValues[(srcX + 1) + ";" + (srcY)];
            // right side
            for (var i = 0; i < size; i++)
                values[size - 1][i] = prevValues[0][i];
        }

        // if the top chunk is loaded, copy its bottom side
        if (loadedValues[(srcX) + ";" + (srcY - 1)] !== undefined) {
            var prevValues = loadedValues[(srcX) + ";" + (srcY - 1)];
            // top side
            for (var i = 0; i < size; i++)
                values[i][0] = prevValues[i][size - 1];
        }

        // if the bottom chunk is loaded, copy its top side
        if (loadedValues[(srcX) + ";" + (srcY + 1)] !== undefined) {
            var prevValues = loadedValues[(srcX) + ";" + (srcY + 1)];
            // bottom side
            for (var i = 0; i < size; i++)
                values[i][size - 1] = prevValues[i][0];
        }

        // diagonals

        // if the left top chunk is loaded, copy its right bottom value
        if (loadedValues[(srcX - 1) + ";" + (srcY - 1)] !== undefined) {
            var prevValues = loadedValues[(srcX - 1) + ";" + (srcY - 1)];
            values[0][0] = prevValues[size - 1][size - 1];
        }

        // if the right top chunk is loaded, copy its left bottom value
        if (loadedValues[(srcX + 1) + ";" + (srcY - 1)] !== undefined) {
            var prevValues = loadedValues[(srcX + 1) + ";" + (srcY - 1)];
            values[size - 1][0] = prevValues[0][size - 1];
        }

        // if the left bottom chunk is loaded, copy its right top value
        if (loadedValues[(srcX - 1) + ";" + (srcY + 1)] !== undefined) {
            var prevValues = loadedValues[(srcX - 1) + ";" + (srcY + 1)];
            values[0][size - 1] = prevValues[size - 1][0];
        }

        // if the right bottom chunk is loaded, copy its left top value
        if (loadedValues[(srcX + 1) + ";" + (srcY + 1)] !== undefined) {
            var prevValues = loadedValues[(srcX + 1) + ";" + (srcY + 1)];
            values[size - 1][size - 1] = prevValues[0][0];
        }

        // if any of the corners are not initialised, give them random values

        if (values[0][0] === undefined)
            values[0][0] = Math.random();

        if (values[size - 1][0] === undefined)
            values[size - 1][0] = Math.random();

        if (values[0][size - 1] === undefined)
            values[0][size - 1] = Math.random();

        if (values[size - 1][size - 1] === undefined)
            values[size - 1][size - 1] = Math.random();

        return values;
    }


    /// <summary>
    /// Applies the diamond square algorithm on the given initial array for a chunk
    /// </summary>
    /// <param name='initialArray'>The initial array for the chunk to apply the algorithm on</param>
    /// <param name='loadedValues'>The loaded chunks</param>
    /// <param name='srcX'>The x coordinate of the chunk</param>
    /// <param name='srcY'>The y coordinate of the chunk</param>
    /// <returns>The filled in array</returns>
    function generateArray(initialArray, loadedValues, srcX, srcY, roughness) {
        var appliedRoughness = roughness;

        var values = initialArray;

        // the algorithm is programmed in an iterative approach rather than a recursive one
        // the outer while loop keeps dividing its length into 2, until <= 2.
        // for each division the range of the random parameter is also halved
        // (like the fractal midpoint algorithm)
        // see http://www.gameprogrammer.com/fractal.html for more info

        var length = size;
        while (length > 2) {
            // perform diamond step
            for (var j = 0; j < size - 1; j += length - 1) {
                for (var i = 0; i < size - 1; i += length - 1) {
                    // the square is i,j ------------ i + length -1, j
                    //               |                     |
                    //               |                     |
                    //              i + length -1 ----i + length -1, j + length - 1

                    // we need to calc point in the middle
                    var randomParam = ((2 * Math.random()) - 1) * appliedRoughness;

                    // determine the center point of the square bounding box
                    var destX = Math.floor(i / 2 + (i + length - 1) / 2);
                    var destY = Math.floor(j / 2 + (j + length - 1) / 2);

                    // if the value isn't present already,
                    // set it to the average of the corner points and add the random parameter
                    if (values[destX][destY] === undefined) {
                        values[destX][destY] = average(values[i][j],
                                                       values[i + length - 1][j],
                                                       values[i][j + length - 1],
                                                       values[i + length - 1][j + length - 1])
                                               + randomParam;

                        // clip the values if they fall outside [0,1]
                        if (values[destX][destY] < 0) values[destX][destY] = 0;
                        if (values[destX][destY] > 1) values[destX][destY] = 1;

                        //console.log("DS values[" + destX + "][" + destY + "] = " + values[destX][destY]);
                    }
                }
            }

            // done the diamond step
            // perform square step
            var halfsize = Math.floor(length / 2);

            for (var j = 0; j <= size - 1; j += halfsize) //length - 1)
            {
                for (var i = (Math.floor(j / halfsize) % 2 === 0 ? halfsize : 0) ; i <= size - 1; i += length - 1) {
                    // for each square, determine midpoint of surrounding 4 diamonds
                    doDiamondOnMidpoint(values, i, j, length, appliedRoughness, loadedValues, srcX, srcY);
                }
            }

            appliedRoughness = appliedRoughness / 2; //* (1 - ((roughness * (Math.pow(2, -roughness)))));

            length = Math.floor(((length - 1) / 2) + 1);
        }

        return values;
    }

    /// <summary>
    /// Applies the diamond step of the diamond square algorithm
    /// </summary>
    /// <param name='values'>The current array to fill data in</param>
    /// <param name='midpointX'>The center x coordinate of the square</param>
    /// <param name='midpointY'>The center y coordinate of the square</param>
    /// <param name='length'>The current length of a square</param>
    /// <param name='weight'>The current roughness to apply</param>
    /// <param name='srcX'>The x coordinate of the chunk</param>
    /// <param name='srcY'>The y coordinate of the chunk</param>
    function doDiamondOnMidpoint(values, midpointX, midpointY, length, weight, loadedValues, srcX, srcY) {
        //if the target value isn't filled in yet
        if (values[midpointX][midpointY] === undefined) {

            // determine bounds of the square
            var halfLength = Math.floor(length / 2);
            var left = midpointX - halfLength;
            var right = midpointX + halfLength;
            var top = midpointY - halfLength;
            var bottom = midpointY + halfLength;

            // get the 4 required values.
            // at the edge of the chunk the values will need to be read from the adjacent chunks
            // if the adjactent chunks aren't loaded, some might be undefined. The average function
            // skips values that are undefined.
            //            pTop
            //        -----+-----
            //        |         |
            // pLeft  +    M    + pRight
            //        |         |
            //        -----+-----
            //           pBottom
            var pLeft = getValueRaw(loadedValues, left, midpointY, values, srcX, srcY);
            var pRight = getValueRaw(loadedValues, right, midpointY, values, srcX, srcY);
            var pTop = getValueRaw(loadedValues, midpointX, top, values, srcX, srcY);
            var pBottom = getValueRaw(loadedValues, midpointX, bottom, values, srcX, srcY);

            // determine random factor
            var randomParam = ((2 * Math.random()) - 1) * weight;

            // determine resulting value by averaging the 4 points and adding the random factor
            var value = average(pLeft, pTop, pRight, pBottom) + randomParam;

            // clip the value if it falls outside [0,1]
            if (value < 0) value = 0;
            if (value > 1) value = 1;

            values[midpointX][midpointY] = value;
        }
    }


    /// <summary>
    /// Returns the value at the given x & y coordinates
    /// </summary>
    /// <param name='loadedValues'>The loaded chunks</param>
    /// <param name='x'>The x coordinate</param>
    /// <param name='y'>The y coordinate</param>
    /// <param name='curvalues'>The current array used for the new chunk</param>
    /// <param name='srcX'>The x coordinate of the chunk</param>
    /// <param name='srcY'>The y coordinate of the chunk</param>
    /// <returns>A value at the specified coordinates or undefined if the coordinates fall in an adjacent chunk that isn't loaded</returns>
    function getValueRaw(loadedValues, x, y, curvalues, srcX, srcY) {
        // if the coordinates fall inside the chunk array, look up the value in the current array
        if (x >= 0 && y >= 0 && x < size && y < size)
            return curvalues[x][y];

        // determine the adjacent chunk coordinates
        var dstX = Math.floor((srcX * size + x) / size);
        var dstY = Math.floor((srcY * size + y) / size);

        // check if the chunk is loaded
        var values = loadedValues[dstX + ";" + dstY];
        if (values === undefined) {
            return undefined;
        }
        else {
            // determine the x & y position inside the adjacent chunk and return its value
            var arrX = x >= 0 ? x % size : (size - 1) - (Math.abs(x) % size);
            var arrY = y >= 0 ? y % size : (size - 1) - (Math.abs(y) % size);
            return values[arrX][arrY];
        }
    }

    /// <summary>
    /// Returns the average of the given points. If any of the points are undefined,
    /// they will be skipped
    /// </summary>
    /// <param name='p1'>The 1st value</param>
    /// <param name='p2'>The 2nd value</param>
    /// <param name='p3'>The 3rd value</param>
    /// <param name='p4'>The 4th value</param>
    /// <returns>An average of the given values</returns>
    function average(p1, p2, p3, p4) {
        var sum = 0;
        var count = 0;
        if (p1 !== undefined) {
            sum += p1;
            count++;
        }
        if (p2 !== undefined) {
            sum += p2;
            count++;
        }
        if (p3 !== undefined) {
            sum += p3;
            count++;
        }
        if (p4 !== undefined) {
            sum += p4;
            count++;
        }

        return sum / count;
    }


    /// <summary>
    /// Create a html5 canvas element that represents the given chunk's values.
    /// The element will has the same left & top based on the chunk coordinates
    /// </summary>
    /// <param name='x'>The x coordinate of the chunk</param>
    /// <param name='y'>The y coordinate of the chunk</param>
    /// <param name='size'>The size of the chunk</param>
    /// <param name='values'>The values of the chunk</param>
    /// <returns>A canvas element that represents the chunk</returns>
    function createTerrainCanvas(x, y, size, values) {
        var c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        $(c).css({
            left: size * x,
            top: size * y,
            position: "absolute"
        });
        var ctx = c.getContext("2d");

        for (var j = 0; j < size; j++) {
            for (var i = 0; i < size; i++) {
                var value = values[i][j];
                var byteVal = Math.floor(value * 255);
                ctx.fillStyle = "rgb(" + byteVal + "," + byteVal + "," + byteVal + ")";
                ctx.fillRect(i, j, 1, 1);
            }
        }
        return c;
    }
}

// todo tileset merging : http://jsbin.com/ELOdUJe/2/edit
/// <summary>
/// Class that manages the different tiles of the tileset (and the fuzzy transition of 1 tile into another)
/// </summary>
function TileMergeStorage() {

    this.canvas = initCanvas();
    this.tilesetCtx = this.canvas.getContext("2d");
    this.maskCanvas = document.createElement("canvas");
    this.maskCanvas.width = TILE_WIDTH;
    this.maskCanvas.height = TILE_HEIGHT;
    this.maskCtx = this.maskCanvas.getContext("2d");

    this.tileCanvas = document.createElement("canvas");
    this.tileCanvas.width = TILE_WIDTH;
    this.tileCanvas.height = TILE_HEIGHT;
    this.tileCtx = this.tileCanvas.getContext("2d");

    /// <summary>
    /// Initializes the canvas to store the tiles in
    /// </summary>
    function initCanvas() {
        var c = document.createElement("canvas");
        c.width = TILE_WIDTH;
        c.height = NR_OF_TILES * 16 * TILE_HEIGHT;
        $("#fuzzyTilesetContainer").append(c);

        return c;
    }

    this.loadedTiles = {};
    this.nrOfItems = 0;

    /// <summary>
    /// Draws a tile from the tile storage to the given context
    /// </summary>
    /// <param name='ctx'>The context to draw the tile to</param>
    /// <param name='idx'>The index of the tile in the tileset</param>
    /// <param name='sideVisible'>Neighbour data of the sides of the tile</param>
    /// <param name='tileRect'>The bounds of the tile</param>
    /// <param name='srcX'>The source X coordinate of the tile entry in the tileset</param>
    /// <param name='srcY'>The source Y coordinate of the tile entry in the tileset</param>
    this.drawTile = function (ctx, idx, sideVisible, tileRect, srcX, srcY) {

        if (!fuzzyTransition) {
            // draw the tile directly from the tileset
            ctx.drawImage(tileset, srcX, srcY, TILE_WIDTH, TILE_HEIGHT, tileRect.left, tileRect.top, tileRect.right - tileRect.left + 1, tileRect.bottom - tileRect.top + 1);
            return;
        }

        // if there is a tile at the X side and Y side with a different tile index, look up the transition tile
        if (sideVisible.xSideValue !== undefined && sideVisible.xSideValue != idx && sideVisible.ySideValue != idx) {
            var key = "X:" + idx + "->" + sideVisible.xSideValue;
            var tIdx = this.loadedTiles[key];
            if (tIdx === undefined) {
                // create a fuzzy transition from the tile to its neighbour
                tIdx = this.nrOfItems;
                createEntry(tIdx, this, idx, sideVisible.xSideValue, 2, 0, 0, 0);
                this.loadedTiles[key] = tIdx;
                this.nrOfItems++;
            }
            // draw the transition tile
            ctx.drawImage(this.canvas, 0, TILE_HEIGHT * tIdx, TILE_WIDTH, TILE_HEIGHT, tileRect.left, tileRect.top, tileRect.right - tileRect.left + 1, tileRect.bottom - tileRect.top + 1);
        }
            // if there is a tile at the X side with a different tile index, look up the transition tile
        else if (sideVisible.xSideValue !== undefined && sideVisible.xSideValue != idx) {
            var key = "X:" + idx + "->" + sideVisible.xSideValue;
            var tIdx = this.loadedTiles[key];
            if (tIdx === undefined) {
                // create a fuzzy transition from the tile to its neighbour
                tIdx = this.nrOfItems;
                createEntry(tIdx, this, idx, sideVisible.xSideValue, 2, 0, 0, 0);
                this.loadedTiles[key] = tIdx;
                this.nrOfItems++;
            }
            // draw the transition tile
            ctx.drawImage(this.canvas, 0, TILE_HEIGHT * tIdx, TILE_WIDTH, TILE_HEIGHT, tileRect.left, tileRect.top, tileRect.right - tileRect.left + 1, tileRect.bottom - tileRect.top + 1);
        }
            // if there is a tile at the Y side with a different tile index, look up the transition tile
        else if (sideVisible.ySideValue !== undefined && sideVisible.ySideValue != idx) {
            var key = "Y:" + idx + "->" + sideVisible.ySideValue;
            var tIdx = this.loadedTiles[key];
            if (tIdx === undefined) {
                // create a fuzzy transition from the tile to its neighbour
                tIdx = this.nrOfItems;
                createEntry(tIdx, this, sideVisible.ySideValue, idx, 0, 0, 2, 0);
                this.loadedTiles[key] = tIdx;
                this.nrOfItems++;
            }
            // draw the transition tile
            ctx.drawImage(this.canvas, 0, TILE_HEIGHT * tIdx, TILE_WIDTH, TILE_HEIGHT, tileRect.left, tileRect.top, tileRect.right - tileRect.left + 1, tileRect.bottom - tileRect.top + 1);

        }
        else // just draw the tile from the tileset
            ctx.drawImage(tileset, srcX, srcY, TILE_WIDTH, TILE_HEIGHT, tileRect.left, tileRect.top, tileRect.right - tileRect.left + 1, tileRect.bottom - tileRect.top + 1);
    };


    /// <summary>
    /// Creates a tile transition from one value in the tileset to another and store it in the canvas
    /// </summary>
    /// <param name='idx'>The new index to use</param>
    /// <param name='store'>The storage to store the created tile in</param>
    /// <param name='from'>The source index in the tileset</param>
    /// <param name='to'>The target index in the tileset</param>
    /// <param name='left'>The left weight, weights determine where the transition will start and how it is angled</param>
    /// <param name='top'>The top weight, weights determine where the transition will start and how it is angled</param>
    /// <param name='right'>The right weight, weights determine where the transition will start and how it is angled</param>
    /// <param name='bottom'>The bottom weight, weights determine where the transition will start and how it is angled</param>
    function createEntry(idx, store, from, to, left, top, right, bottom) {
        console.log("Creating entry " + idx + " in tileset: " + from + " -> " + to);
        var fromX = (from % TILESET_ITEMS_PER_ROW) * TILE_WIDTH;
        var fromY = Math.floor(from / TILESET_ITEMS_PER_ROW) * TILE_HEIGHT;

        var toX = (to % TILESET_ITEMS_PER_ROW) * TILE_WIDTH;
        var toY = Math.floor(to / TILESET_ITEMS_PER_ROW) * TILE_HEIGHT;

        // create mask
        fillMask(store.maskCtx, left, top, right, bottom);
        // create region
        store.tileCtx.drawImage(tileset, 0, 0, TILE_WIDTH, TILE_HEIGHT, 0, 0, TILE_WIDTH, TILE_HEIGHT);

        // apply mask on region
        store.tileCtx.globalCompositeOperation = 'source-in';
        store.tileCtx.drawImage(store.maskCanvas, 0, 0, TILE_WIDTH, TILE_HEIGHT, 0, 0, TILE_WIDTH, TILE_HEIGHT);

        // draw from tile
        store.tileCtx.drawImage(tileset, fromX, fromY, TILE_WIDTH, TILE_HEIGHT, 0, 0, TILE_WIDTH, TILE_HEIGHT);
        store.tileCtx.globalCompositeOperation = 'destination-over';

        // draw to tile
        store.tileCtx.drawImage(tileset, toX, toY, TILE_WIDTH, TILE_HEIGHT, 0, 0, TILE_WIDTH, TILE_HEIGHT);

        // draw tile to tileset
        store.tilesetCtx.drawImage(store.tileCanvas, 0, 0, TILE_WIDTH, TILE_HEIGHT, 0, TILE_HEIGHT * idx, TILE_WIDTH, TILE_HEIGHT);
    }


    /// <summary>
    /// Creates a mask for the transition tile on the given context
    /// </summary>
    /// <param name='ctxMask'>The context to create the mask on</param>
    /// <param name='p1'>The left weight, weights determine where the transition will start and how it is angled</param>
    /// <param name='p2'>The top weight, weights determine where the transition will start and how it is angled</param>
    /// <param name='p3'>The right weight, weights determine where the transition will start and how it is angled</param>
    /// <param name='p4'>The bottom weight, weights determine where the transition will start and how it is angled</param>
    function fillMask(ctxMask, p1, p2, p3, p4) {

        ctxMask.clearRect(0, 0, TILE_WIDTH, TILE_HEIGHT);
        for (var j = 0; j < TILE_HEIGHT; j++) {
            for (var i = 0; i < TILE_WIDTH; i++) {
                var xAlpha = (i) / TILE_WIDTH;
                var yAlpha = (j) / TILE_HEIGHT;

                // 2D linear transition, holding weights in account
                var val = (1 - xAlpha) * (1 - yAlpha) * p1 +
                          (1 - xAlpha) * yAlpha * p3 +
                          xAlpha * (1 - yAlpha) * p2 +
                          xAlpha * yAlpha * p4;

                if (Math.random() < val)
                    ctxMask.fillRect(i, j, 1, 1);
            }
        }
    }
}

/// <summary>
/// Creates a new rectangle
/// </summary>
/// <param name='left'>The left bounds of the rectangle</param>
/// <param name='top'>The top bounds of the rectangle</param>
/// <param name='width'>The width of the rectangle</param>
/// <param name='height'>The height of the rectangle</param>
/// <returns>A rectangle with given dimensions</returns>
function newRect(left, top, width, height) {
    return {
        left: left,
        top: top,
        width: width,
        height: height,
        right: left + width - 1,
        bottom: top + height - 1,
    };
}

/// <summary>
/// Scales a given rectangle with the given factor
/// </summary>
/// <param name='r'>The rectangle to scale</param>
/// <param name='val'>The factor</param>
function scaleRect(r, val) {
    r.left *= val;
    r.top *= val;
    r.width *= val;
    r.height *= val;
    r.right = r.left + r.width - 1;
    r.bottom = r.top + r.height - 1;
}

/// <summary>
/// Translates a given rectangle with x,y offset
/// </summary>
/// <param name='r'>The rectangle to scale</param>
/// <param name='x'>The translation on the X axis</param>
/// <param name='x'>The translation on the Y axis</param>
function moveRect(r, x, y) {
    r.left += x;
    r.top += y;
    r.right += x;
    r.bottom += y;
}


/// <summary>
/// Times a given function and updates the time in the stats
/// </summary>
/// <param name='name'>The name of the function to time</param>
/// <param name='script'>The function to time</param>
function timeFunction(name, script) {
    var start = new Date();
    script();
    var result = new Date() - start;
    stats.drawIncrementalMs = result;
}

// if requestAnimation is not available in the browser, use a window.setTimeout with 10ms instead
if (window.requestAnimationFrame === undefined) {
    window.requestAnimationFrame = function (func) {
        window.setTimeout(func, 10);
    }
}