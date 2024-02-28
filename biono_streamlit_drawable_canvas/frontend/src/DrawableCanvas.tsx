import React, { useEffect, useState } from "react"
import {
  ComponentProps,
  Streamlit,
  withStreamlitConnection,
} from "streamlit-component-lib"
import { fabric } from "fabric"
import { isEqual } from "lodash"

import CanvasToolbar from "./components/CanvasToolbar"
import UpdateStreamlit from "./components/UpdateStreamlit"

import { useCanvasState } from "./DrawableCanvasState"
import { tools, FabricTool } from "./lib"

let is_mouse_down = false
let lastPosX = 0
let lastPosY = 0

function getStreamlitBaseUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  const baseUrl = params.get("streamlitUrl")
  if (baseUrl == null) {
    return null
  }

  try {
    return new URL(baseUrl).origin
  } catch {
    return null
  }
}

/**
 * Arguments Streamlit receives from the Python side
 */
export interface PythonArgs {
  fillColor: string
  strokeWidth: number
  strokeColor: string
  backgroundColor: string
  backgroundImageURL: string
  realtimeUpdateStreamlit: boolean
  canvasWidth: number
  canvasHeight: number
  drawingMode: string
  initialDrawing: Object
  displayToolbar: boolean
  displayRadius: number
}

/**
 * Define logic for the canvas area
 */
const DrawableCanvas = ({ args }: ComponentProps) => {
  const {
    canvasWidth,
    canvasHeight,
    backgroundColor,
    backgroundImageURL,
    realtimeUpdateStreamlit,
    drawingMode,
    fillColor,
    strokeWidth,
    strokeColor,
    displayRadius,
    initialDrawing,
    displayToolbar,
  }: PythonArgs = args

  /**
   * State initialization
   */
  const [canvas, setCanvas] = useState(new fabric.Canvas(""))
  canvas.stopContextMenu = true
  canvas.fireRightClick = true

  const [backgroundCanvas, setBackgroundCanvas] = useState(
    new fabric.StaticCanvas("")
  )
  const {
    canvasState: {
      action: { shouldReloadCanvas, forceSendToStreamlit },
      currentState,
      initialState,
    },
    saveState,
    undo,
    redo,
    canUndo,
    canRedo,
    forceStreamlitUpdate,
    resetState,
  } = useCanvasState()

  /**
   * Initialize canvases on component mount
   * NB: Remount component by changing its key instead of defining deps
   */
  useEffect(() => {
    const c = new fabric.Canvas("canvas", {
      enableRetinaScaling: false,
    })
    const imgC = new fabric.StaticCanvas("backgroundimage-canvas", {
      enableRetinaScaling: false,
    })
    setCanvas(c)
    setBackgroundCanvas(imgC)
    Streamlit.setFrameHeight()
  }, [])

  /**
   * Load user drawing into canvas
   * Python-side is in charge of initializing drawing with background color if none provided
   */
  useEffect(() => {
    if (!isEqual(initialState, initialDrawing)) {
      canvas.loadFromJSON(initialDrawing, () => {
        canvas.renderAll()
        resetState(initialDrawing)
      })
    }
  }, [canvas, initialDrawing, initialState, resetState])

  /**
   * If state changed from undo/redo/reset, update user-facing canvas
   */
  useEffect(() => {
    if (shouldReloadCanvas) {
      canvas.loadFromJSON(currentState, () => {})
    }
  }, [canvas, shouldReloadCanvas, currentState])


// START CUSTOM BIONOMEEX ================

  const preventOutbounds = () => {
    var zoom = canvas.getZoom();

    var vpt = canvas.viewportTransform;
    if (vpt) {
      let limit_width = canvas.getWidth()
      let limit_height = canvas.getHeight()
      if (backgroundImageURL) {
        const baseUrl = getStreamlitBaseUrl() ?? "";
        fabric.Image.fromURL(baseUrl + backgroundImageURL, function(img) {
          limit_width = img.width ?? canvas.getWidth()
          limit_height = img.height ?? canvas.getHeight()
        });
      }
      let vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
      let vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
      if (vw < limit_width) {
        limit_width = limit_width*2 - vw
      }
      if (vh < limit_height) {
        limit_height = limit_height*2 - vh
      }

      var zoomedWidth = limit_width * zoom;
      var zoomedHeight = limit_height * zoom;

      var topLeftX = vpt[4];
      var topLeftY = vpt[5];
      var bottomRightX = topLeftX + zoomedWidth;
      var bottomRightY = topLeftY + zoomedHeight;
      var dx = 0, dy = 0;

      if (topLeftX > 0) dx = -topLeftX;
      if (topLeftY > 0) dy = -topLeftY;
      if (bottomRightX < limit_width) dx = limit_width - bottomRightX;
      if (bottomRightY < limit_height) dy = limit_height - bottomRightY;
      // vpt[4] += dx;
      // vpt[5] += dy;

      canvas.requestRenderAll();
    }
  }

  canvas.on('mouse:wheel', function(opt) {
    var delta = opt.e.deltaY;
    var zoom = canvas.getZoom();
    zoom = Math.min(20, Math.max(1.01, zoom * 0.9996 ** delta));
    canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);

    preventOutbounds();

    opt.e.preventDefault();
    opt.e.stopPropagation();
  });


  canvas.on('mouse:down', function(opt) {
    is_mouse_down = true

    var pointer = canvas.getPointer(opt.e);
    lastPosX = pointer.x;
    lastPosY = pointer.y;
  })


  canvas.on('mouse:move', function(opt) {
    if (!is_mouse_down|| !opt.e.altKey) return;

    var vpt = canvas.viewportTransform;
    if (vpt) {
      var pointer = canvas.getPointer(opt.e);
  
      var posX = pointer.x;
      var posY = pointer.y;
  
      var diffX = posX - lastPosX;
      var diffY = posY - lastPosY;

      vpt[4] += diffX;
      vpt[5] += diffY;

      canvas.requestRenderAll();

      lastPosX = posX;
      lastPosY = posY;

      preventOutbounds()

      opt.e.preventDefault();
      opt.e.stopPropagation();
    }
  })

  canvas.on('mouse:up', function() {
    is_mouse_down = false
  })

  useEffect(() => {
    preventOutbounds();
    if (backgroundImageURL) {
      const baseUrl = getStreamlitBaseUrl() ?? "";
      fabric.Image.fromURL(baseUrl + backgroundImageURL, function(img) {
        canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas), {
          scaleX: canvas.getWidth() / (img.width ?? 1),
          scaleY: canvas.getHeight() / (img.height ?? 1)
        });
      });
    }
  }, [backgroundImageURL, canvas]);
  

// END CUSTOM BIONOMEEX ================

  /**
   * Update canvas with selected tool
   * PS: add initialDrawing in dependency so user drawing update reinits tool
   */
  useEffect(() => {
    // Update canvas events with selected tool
    const selectedTool = new tools[drawingMode](canvas) as FabricTool

    const cleanupToolEvents = selectedTool.configureCanvas({
      fillColor: fillColor,
      strokeWidth: strokeWidth,
      strokeColor: strokeColor,
      displayRadius: displayRadius
    })


    canvas.on("mouse:up", (e: any) => {
      saveState(canvas.toJSON())
      if (e["button"] === 3) {
        forceStreamlitUpdate()
      }
    })

    canvas.on("mouse:dblclick", () => {
      saveState(canvas.toJSON())
    })

    // Cleanup tool + send data to Streamlit events
    return () => {
      cleanupToolEvents()
      canvas.off("mouse:up")
      canvas.off("mouse:wheel")
      canvas.off("mouse:down")
      canvas.off("mouse:move")
      canvas.off("mouse:dblclick")
    }
  }, [
    canvas,
    strokeWidth,
    strokeColor,
    displayRadius,
    fillColor,
    drawingMode,
    initialDrawing,
    saveState,
    forceStreamlitUpdate,
  ])

  /**
   * Render canvas w/ toolbar
   */
  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: -10,
          visibility: "hidden",
        }}
      >
        <UpdateStreamlit
          canvasHeight={canvasHeight}
          canvasWidth={canvasWidth}
          shouldSendToStreamlit={
            realtimeUpdateStreamlit || forceSendToStreamlit
          }
          stateToSendToStreamlit={currentState}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 0,
        }}
      >
        <canvas
          id="backgroundimage-canvas"
          width={canvasWidth}
          height={canvasHeight}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 10,
        }}
      >
        <canvas
          id="canvas"
          width={canvasWidth}
          height={canvasHeight}
          style={{ border: "transparant" }}
        />
      </div>
      {displayToolbar && (
        <CanvasToolbar
          topPosition={canvasHeight}
          leftPosition={canvasWidth}
          canUndo={canUndo}
          canRedo={canRedo}
          downloadCallback={forceStreamlitUpdate}
          undoCallback={undo}
          redoCallback={redo}
          resetCallback={() => {
            resetState(initialState)
          }}
        />
      )}
    </div>
  )
}

export default withStreamlitConnection(DrawableCanvas)