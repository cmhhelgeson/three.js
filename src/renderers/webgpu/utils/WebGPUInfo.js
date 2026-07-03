import Info from '../../common/Info.js';

export class WebGPUInfo extends Info {


	constructor() {

		super();

		/**
		 * Metrics specific to the WebGPU Backend.
		 *
		 * @type {Object}
		 * @readonly
		 * @property {number} encoderSubmissions - The number of command encoder submissions
		 * (`device.queue.submit()` calls) of the current frame. A single submission can carry
		 * the command buffers of multiple render and compute passes.
		 */
		this.backend = {
			encoderSubmissions: 0
		};


	}


	/**
	 * Resets WebGPU backend related metrics.
	 */

	reset() {

		super.reset();

		this.backend.encoderSubmissions = 0;

	}


}
