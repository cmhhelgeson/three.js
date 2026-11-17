/**
 * Loads the WebGL 2 backend module of {@link WebGPURenderer}. It's kept out of the main
 * WebGPU build and only downloaded on first use. Besides `WebGLBackend`, the module provides
 * `GLSLNodeBuilder` and `WebGLCapabilities`, which are used to compile node materials to GLSL
 * outside of `WebGPURenderer`, e.g. by `WebGLNodesHandler`.
 *
 * ```js
 * const { GLSLNodeBuilder, WebGLCapabilities } = await loadWebGLBackend();
 * ```
 *
 * @return {Promise<{WebGLBackend: WebGLBackend, GLSLNodeBuilder: GLSLNodeBuilder, WebGLCapabilities: WebGLCapabilities}>} A Promise that resolves with the module's exports.
 */
export function loadWebGLBackend() {

	return import( '../../Three.WebGPU.WebGL.js' );

}
