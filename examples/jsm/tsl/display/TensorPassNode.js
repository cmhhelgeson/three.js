import { Vector2, TempNode, NodeUpdateType } from 'three/webgpu';
import { Fn, uv, uniform, convertToTexture, vec2, vec4, mat3, add } from 'three/tsl';

/**
 * Post processing node for computing the structure tensor of the input.
 *
 * The structure tensor summarizes the dominant gradient direction in the
 * neighborhood of a fragment. It is computed by convolving the input with the
 * horizontal and vertical sobel kernels and storing the products of the
 * resulting gradients in a single texel:
 * ```
 * ( dot( Sx, Sx ), dot( Sy, Sy ), dot( Sx, Sy ), 1 )
 * ```
 * The result is usually not displayed directly but used as the input of effects
 * like anisotropic Kuwahara filtering or flow-based image abstraction.
 *
 * @augments TempNode
 * @three_import import { tensor } from 'three/addons/tsl/display/TensorPassNode.js';
 */
class TensorPassNode extends TempNode {

	static get type() {

		return 'TensorPassNode';

	}

	/**
	 * Constructs a new tensor pass node.
	 *
	 * @param {TextureNode} textureNode - The texture node that represents the input of the effect.
	 */
	constructor( textureNode ) {

		super( 'vec4' );

		/**
		 * The texture node that represents the input of the effect.
		 *
		 * @type {TextureNode}
		 */
		this.textureNode = textureNode;

		/**
		 * The `updateBeforeType` is set to `NodeUpdateType.FRAME` since the node updates
		 * its internal uniforms once per frame in `updateBefore()`.
		 *
		 * @type {string}
		 * @default 'frame'
		 */
		this.updateBeforeType = NodeUpdateType.FRAME;

		/**
		 * A uniform node holding the inverse resolution value.
		 *
		 * @private
		 * @type {UniformNode<vec2>}
		 */
		this._invSize = uniform( new Vector2() );

	}

	/**
	 * This method is used to update the effect's uniforms once per frame.
	 *
	 * @param {NodeFrame} frame - The current node frame.
	 */
	updateBefore( /* frame */ ) {

		const map = this.textureNode.value;

		this._invSize.value.set( 1 / map.image.width, 1 / map.image.height );

	}

	/**
	 * This method is used to setup the effect's TSL code.
	 *
	 * @param {NodeBuilder} builder - The current node builder.
	 * @return {ShaderCallNodeInternal}
	 */
	setup( /* builder */ ) {

		const { textureNode } = this;

		const uvNode = textureNode.uvNode || uv();

		const sampleTexture = ( uv ) => textureNode.sample( uv ).rgb;

		const structureTensor = Fn( () => {

			const texel = this._invSize;

			// kernel definition (in glsl matrices are filled in column-major order)

			const Gx = mat3( - 1, - 2, - 1, 0, 0, 0, 1, 2, 1 ); // x direction kernel
			const Gy = mat3( - 1, 0, 1, - 2, 0, 2, - 1, 0, 1 ); // y direction kernel

			// fetch the 3x3 neighbourhood of a fragment

			// first column

			const tx0y0 = sampleTexture( uvNode.add( texel.mul( vec2( - 1, - 1 ) ) ) );
			const tx0y1 = sampleTexture( uvNode.add( texel.mul( vec2( - 1, 0 ) ) ) );
			const tx0y2 = sampleTexture( uvNode.add( texel.mul( vec2( - 1, 1 ) ) ) );

			// second column

			const tx1y0 = sampleTexture( uvNode.add( texel.mul( vec2( 0, - 1 ) ) ) );
			const tx1y1 = sampleTexture( uvNode.add( texel.mul( vec2( 0, 0 ) ) ) );
			const tx1y2 = sampleTexture( uvNode.add( texel.mul( vec2( 0, 1 ) ) ) );

			// third column

			const tx2y0 = sampleTexture( uvNode.add( texel.mul( vec2( 1, - 1 ) ) ) );
			const tx2y1 = sampleTexture( uvNode.add( texel.mul( vec2( 1, 0 ) ) ) );
			const tx2y2 = sampleTexture( uvNode.add( texel.mul( vec2( 1, 1 ) ) ) );

			// gradient in x direction

			const Sx = add(
				tx0y0.mul( Gx[ 0 ][ 0 ] ),
				tx1y0.mul( Gx[ 1 ][ 0 ] ),
				tx2y0.mul( Gx[ 2 ][ 0 ] ),
				tx0y1.mul( Gx[ 0 ][ 1 ] ),
				tx1y1.mul( Gx[ 1 ][ 1 ] ),
				tx2y1.mul( Gx[ 2 ][ 1 ] ),
				tx0y2.mul( Gx[ 0 ][ 2 ] ),
				tx1y2.mul( Gx[ 1 ][ 2 ] ),
				tx2y2.mul( Gx[ 2 ][ 2 ] )
			).toVar();

			// gradient in y direction

			const Sy = add(
				tx0y0.mul( Gy[ 0 ][ 0 ] ),
				tx1y0.mul( Gy[ 1 ][ 0 ] ),
				tx2y0.mul( Gy[ 2 ][ 0 ] ),
				tx0y1.mul( Gy[ 0 ][ 1 ] ),
				tx1y1.mul( Gy[ 1 ][ 1 ] ),
				tx2y1.mul( Gy[ 2 ][ 1 ] ),
				tx0y2.mul( Gy[ 0 ][ 2 ] ),
				tx1y2.mul( Gy[ 1 ][ 2 ] ),
				tx2y2.mul( Gy[ 2 ][ 2 ] )
			).toVar();

			return vec4( Sx.dot( Sx ), Sy.dot( Sy ), Sx.dot( Sy ), 1 );

		} );

		const outputNode = structureTensor();

		return outputNode;

	}

}

export default TensorPassNode;

/**
 * TSL function for creating a tensor pass node which computes the structure tensor of the input.
 *
 * @tsl
 * @function
 * @param {Node<vec4>} node - The node that represents the input of the effect.
 * @returns {TensorPassNode}
 */
export const tensor = ( node ) => new TensorPassNode( convertToTexture( node ) );
