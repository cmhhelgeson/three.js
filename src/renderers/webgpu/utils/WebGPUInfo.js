import Info from '../../common/Info.js';

/**
 * Holds the statistics of the renderer with metrics specific to the WebGPU backend.
 *
 * @augments Info
 */
class WebGPUInfo extends Info {

	/**
	 * Constructs a new WebGPU info component.
	 */
	constructor() {

		super();

		/**
		 * Metrics specific to the WebGPU backend, gathered when the backend tracks hazards ( `trackHazards` ).
		 * See {@link WebGPUHazardTracker}.
		 *
		 * @type {Object}
		 * @readonly
		 * @property {number} batches - The number of submits the frame would need if the commands of a task were
		 * submitted in one batch, split on every conflict.
		 * @property {Object} conflicts - Per kind of resource ( `uniform`, `attribute`, `storage`, `indirect`, `texture`,
		 * `destroy` ), the number of queue writes or destructions of the frame that hit a resource used by the current batch.
		 */
		this.backend = {
			batches: 0,
			conflicts: {
				uniform: 0,
				attribute: 0,
				storage: 0,
				indirect: 0,
				texture: 0,
				destroy: 0
			}
		};

	}

	/**
	 * Resets frame related metrics.
	 */
	reset() {

		super.reset();

		const backend = this.backend;

		backend.batches = 0;

		for ( const type in backend.conflicts ) backend.conflicts[ type ] = 0;

	}

}

export default WebGPUInfo;
