// The WebGL 2 backend of WebGPURenderer. WebGPURenderer imports it on demand when WebGL 2 is
// forced or WebGPU is not available, so it is kept out of the main WebGPU build.
export * from './Three.WebGL.TSL.js';

export { default as WebGLBackend } from './renderers/webgl-fallback/WebGLBackend.js';

