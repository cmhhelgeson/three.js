import Renderer from '../common/Renderer.js';
import Backend from '../common/Backend.js';
import WebGPUBackend from './WebGPUBackend.js';
import BasicNodeLibrary from './nodes/BasicNodeLibrary.js';
import { loadWebGLBackend } from '../webgl-fallback/loadWebGLBackend.js';
import { warn } from '../../utils.js';

/**
 * This alternative version of {@link WebGPURenderer} only supports node materials.
 * So classes like `MeshBasicMaterial` are not compatible.
 *
 * @private
 * @augments Renderer
 */
class WebGPURenderer extends Renderer {

	/**
	 * Constructs a new WebGPU renderer.
	 *
	 * @param {WebGPURenderer~Options} [parameters] - The configuration parameter.
	 */
	constructor( parameters = {} ) {

		// the WebGL 2 backend is imported on demand, so builds which only run WebGPU don't load it.
		// when it is forced, a generic backend stands in until init() replaces it

		const backend = parameters.forceWebGL ? new Backend( parameters ) : new WebGPUBackend( parameters );

		super( backend, parameters );

		if ( parameters.forceWebGL ) {

			this._getBackend = () => this._createWebGLBackend();

		} else {

			this._getFallback = () => {

				warn( 'WebGPURenderer: WebGPU is not available, running under WebGL2 backend.' );

				return this._createWebGLBackend();

			};

		}

		/**
		 * The generic default value is overwritten with the
		 * standard node library for type mapping. Material
		 * mapping is not supported with this version.
		 *
		 * @type {BasicNodeLibrary}
		 */
		this.library = new BasicNodeLibrary();

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isWebGPURenderer = true;

	}

	/**
	 * Creates the WebGL 2 backend. Its module is imported on first use, so it's only
	 * downloaded when WebGL 2 is forced or WebGPU is not available.
	 *
	 * @private
	 * @return {Promise<Backend>} A Promise that resolves with the WebGL 2 backend.
	 */
	async _createWebGLBackend() {

		const { WebGLBackend } = await loadWebGLBackend();

		return new WebGLBackend( this.backend.parameters );

	}

}

export default WebGPURenderer;
