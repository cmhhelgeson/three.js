import { HalfFloatType, RenderTarget, NodeMaterial, RendererUtils, QuadMesh, TempNode, NodeUpdateType } from 'three/webgpu';
import { Fn, If, Loop, Continue, float, int, ivec2, mat2, vec2, vec3, vec4, uv, floor, textureSize, textureLoad, passTexture, nodeObject, convertToTexture, context, EPSILON } from 'three/tsl';

const _quadMesh = /*@__PURE__*/ new QuadMesh();

let _rendererState;

/**
 * Number of sectors the filter kernel is divided into. The sector weighting
 * below is hardcoded for eight sectors (four sectors plus their 45 degree
 * rotations), so this is not a tweakable parameter.
 *
 * @private
 * @type {number}
 */
const SECTOR_COUNT = 8;

/**
 * Weights of the gradient kernel optimized for rotational symmetry, described
 * in section "3.2.1 Gradient Calculation" of the multi-scale paper.
 *
 * @private
 * @type {number}
 */
const CORNER_WEIGHT = 0.182;
const CENTER_WEIGHT = 1 - 2 * CORNER_WEIGHT;

/**
 * The sector envelope angle and the trigonometric terms derived from it are
 * constant, so they are evaluated on the CPU.
 *
 * @private
 * @type {number}
 */
const SECTOR_ENVELOPE_ANGLE = ( ( 3 / 2 ) * Math.PI ) / SECTOR_COUNT;
const SECTOR_ENVELOPE_COS = Math.cos( SECTOR_ENVELOPE_ANGLE );
const SECTOR_ENVELOPE_SIN_SQUARED = Math.sin( SECTOR_ENVELOPE_ANGLE ) ** 2;

/**
 * Post processing node that applies an anisotropic Kuwahara filter, producing a
 * painterly, brush-stroke like abstraction of the input.
 *
 * The filter places an ellipse around every fragment, oriented along the local
 * direction of minimum change and elongated proportionally to how directional
 * the neighborhood is. The ellipse is split into eight overlapping sectors, and
 * the mean color of the sector with the lowest variance dominates the result.
 * Flat regions are therefore flattened further while edges stay sharp.
 *
 * The effect runs as two passes, matching the reference implementation:
 *
 * 1. The structure tensor of the input is computed into its own render target.
 * 2. The filter reads that tensor back to orient its kernel, and writes the
 *    filtered image.
 *
 * Separating the two is not just bookkeeping. The tensor of a fragment is read
 * once per fragment instead of being recomputed from nine texture fetches, and
 * having the tensor field in a texture is what makes it possible to smooth it
 * before use, which the papers call for.
 *
 * The implementation follows the anisotropic Kuwahara filter described in:
 *
 * - Kyprianidis, Kang, Doellner. "Image and Video Abstraction by Anisotropic
 *   Kuwahara Filtering." 2009.
 * - Kyprianidis et al. "Anisotropic Kuwahara Filtering with Polynomial
 *   Weighting Functions." 2010 (the polynomial sector weights).
 * - Kyprianidis. "Image and Video Abstraction by Multi-Scale Anisotropic
 *   Kuwahara Filtering." 2011 (the gradient kernel and the sector weight
 *   function).
 *
 * @augments TempNode
 * @three_import import { kuwaharaFilter } from 'three/addons/tsl/display/KuwaharaFilterNode.js';
 */
class KuwaharaFilterNode extends TempNode {

	static get type() {

		return 'KuwaharaFilterNode';

	}

	/**
	 * Constructs a new Kuwahara filter node.
	 *
	 * @param {TextureNode} textureNode - The texture node that represents the input of the effect.
	 * @param {Node<float>} [radius=5] - The radius of the filter kernel in pixels.
	 * @param {Node<float>} [sharpness=8] - How strongly the lowest variance sector dominates. Higher values keep edges crisper.
	 * @param {Node<float>} [eccentricity=2] - How far the kernel is allowed to stretch in anisotropic regions. Lower values stretch more.
	 */
	constructor( textureNode, radius = 5, sharpness = 8, eccentricity = 2 ) {

		super( 'vec4' );

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isKuwaharaFilterNode = true;

		/**
		 * The texture node that represents the input of the effect.
		 *
		 * @type {TextureNode}
		 */
		this.textureNode = textureNode;

		/**
		 * The radius of the filter kernel in pixels. This drives the cost of the
		 * effect quadratically, see the note on performance in `setup()`.
		 *
		 * @type {Node<float>}
		 * @default 5
		 */
		this.radius = nodeObject( radius );

		/**
		 * How strongly the sector with the lowest standard deviation dominates
		 * the result. It is the exponent of the sector weighting function, so
		 * small increases have a large effect. A value of zero averages all
		 * sectors equally and degenerates into a plain blur.
		 *
		 * @type {Node<float>}
		 * @default 8
		 */
		this.sharpness = nodeObject( sharpness );

		/**
		 * Controls how far the kernel ellipse may stretch along the dominant
		 * direction. The ellipse width factor tends to one as this tends to
		 * infinity (circular kernel, isotropic filtering) and grows without
		 * bound as it tends to zero.
		 *
		 * @type {Node<float>}
		 * @default 2
		 */
		this.eccentricity = nodeObject( eccentricity );

		/**
		 * The render target holding the structure tensor of the input, written by
		 * the first pass and read by the second. Half float is enough precision
		 * for an orientation estimate, and the tensor is not directly displayed.
		 *
		 * @private
		 * @type {RenderTarget}
		 */
		this._structureTensorRT = new RenderTarget( 1, 1, { depthBuffer: false, type: HalfFloatType } );
		this._structureTensorRT.texture.name = 'KuwaharaFilterNode.structureTensor';

		/**
		 * The render target holding the filtered image.
		 *
		 * @private
		 * @type {RenderTarget}
		 */
		this._outputRT = new RenderTarget( 1, 1, { depthBuffer: false, type: HalfFloatType } );
		this._outputRT.texture.name = 'KuwaharaFilterNode.output';

		/**
		 * The result of the effect as a texture node.
		 *
		 * @private
		 * @type {PassTextureNode}
		 */
		this._textureNode = passTexture( this, this._outputRT.texture );

		/**
		 * The material of the structure tensor pass.
		 *
		 * @private
		 * @type {?NodeMaterial}
		 */
		this._structureTensorMaterial = null;

		/**
		 * The material of the filter pass.
		 *
		 * @private
		 * @type {?NodeMaterial}
		 */
		this._kuwaharaMaterial = null;

		/**
		 * The `updateBeforeType` is set to `NodeUpdateType.FRAME` since the node
		 * renders its effect once per frame in `updateBefore()`.
		 *
		 * @type {string}
		 * @default 'frame'
		 */
		this.updateBeforeType = NodeUpdateType.FRAME;

	}

	/**
	 * Sets the size of the effect.
	 *
	 * @param {number} width - The width of the effect.
	 * @param {number} height - The height of the effect.
	 */
	setSize( width, height ) {

		this._structureTensorRT.setSize( width, height );
		this._outputRT.setSize( width, height );

	}

	/**
	 * Returns the result of the effect as a texture node.
	 *
	 * @return {PassTextureNode} A texture node that represents the result of the effect.
	 */
	getTextureNode() {

		return this._textureNode;

	}

	/**
	 * This method is used to render the effect once per frame.
	 *
	 * @param {NodeFrame} frame - The current node frame.
	 */
	updateBefore( frame ) {

		const { renderer } = frame;

		_rendererState = RendererUtils.resetRendererState( renderer, _rendererState );

		//

		const map = this.textureNode.value;

		this.setSize( map.image.width, map.image.height );

		// preserve the dynamic range of the input, the filter is a weighted mean
		// of input colors and so stays within it

		this._outputRT.texture.type = map.type;

		// structure tensor

		_quadMesh.material = this._structureTensorMaterial;

		renderer.setRenderTarget( this._structureTensorRT );

		_quadMesh.name = 'Kuwahara Filter [ Structure Tensor ]';
		_quadMesh.render( renderer );

		// anisotropic filter

		_quadMesh.material = this._kuwaharaMaterial;

		renderer.setRenderTarget( this._outputRT );

		_quadMesh.name = 'Kuwahara Filter [ Anisotropic ]';
		_quadMesh.render( renderer );

		// restore

		RendererUtils.restoreRendererState( renderer, _rendererState );

	}

	/**
	 * This method is used to setup the effect's TSL code.
	 *
	 * Both passes run at the resolution of the input texture, so a fragment of
	 * the filter pass reads the tensor of the matching texel with an unfiltered
	 * fetch and no resampling.
	 *
	 * Note that the papers smooth the tensor field with a Gaussian between the
	 * two passes, which suppresses high frequency detail and yields longer, more
	 * coherent brush strokes. That is not done here, so the orientation is the
	 * raw per-fragment estimate.
	 *
	 * Performance: the filter loops over the bounding box of the kernel ellipse,
	 * so the tap count grows with the square of `radius`. Two taps are taken per
	 * iteration (a point and its mirror), and the eight sector accumulators are
	 * held in registers. A radius of 5 costs on the order of 100 iterations per
	 * fragment; a radius of 20 costs well over a thousand and is not realtime.
	 *
	 * @param {NodeBuilder} builder - The current node builder.
	 * @return {PassTextureNode}
	 */
	setup( builder ) {

		const textureNode = this.textureNode;
		const inputTex = textureNode.value;
		const structureTensorTex = this._structureTensorRT.texture;

		// Both passes address the input by texel rather than by uv. `textureLoad`
		// has no sampler and therefore no wrap mode, so reads are clamped to the
		// edge of the input explicitly; without that the kernel would read zeros
		// outside the image and darken a band of `radius` pixels at the border.

		const inputTexel = () => {

			const texSize = ivec2( textureSize( textureNode ) ).toConst( 'texSize' );
			const targetUV = uv();

			const texel = ivec2(
				int( floor( targetUV.x.mul( float( texSize.x ) ) ) ),
				int( floor( targetUV.y.mul( float( texSize.y ) ) ) )
			).toConst( 'texel' );

			const maxTexel = texSize.sub( ivec2( 1 ) ).toConst( 'maxTexel' );
			const load = ( position ) => textureLoad( inputTex, position.max( ivec2( 0 ) ).min( maxTexel ) );

			return { texel, load };

		};

		// --- first pass: structure tensor -----------------------------------

		const computeStructureTensor = Fn( () => {

			const { texel, load } = inputTexel();

			// The eight surrounding texels, each fetched once and reused by both
			// partial derivatives.

			const nw = load( texel.add( ivec2( - 1, 1 ) ) ).rgb;
			const n = load( texel.add( ivec2( 0, 1 ) ) ).rgb;
			const ne = load( texel.add( ivec2( 1, 1 ) ) ).rgb;
			const w = load( texel.add( ivec2( - 1, 0 ) ) ).rgb;
			const e = load( texel.add( ivec2( 1, 0 ) ) ).rgb;
			const sw = load( texel.add( ivec2( - 1, - 1 ) ) ).rgb;
			const s = load( texel.add( ivec2( 0, - 1 ) ) ).rgb;
			const se = load( texel.add( ivec2( 1, - 1 ) ) ).rgb;

			const xPartialDerivative = ne.add( se ).sub( nw ).sub( sw ).mul( CORNER_WEIGHT )
				.add( e.sub( w ).mul( CENTER_WEIGHT ) ).toVar( 'xPartialDerivative' );

			const yPartialDerivative = nw.add( ne ).sub( sw ).sub( se ).mul( CORNER_WEIGHT )
				.add( n.sub( s ).mul( CENTER_WEIGHT ) ).toVar( 'yPartialDerivative' );

			const dxdx = xPartialDerivative.dot( xPartialDerivative );
			const dxdy = xPartialDerivative.dot( yPartialDerivative );
			const dydy = yPartialDerivative.dot( yPartialDerivative );

			// Encoded in a vec4 in column major order, so the texel holds the
			// symmetric 2x2 tensor as it is written in the paper. Storing it this
			// way also means a blur pass inserted between the two passes operates
			// on the tensor components directly.

			return vec4( dxdx, dxdy, dxdy, dydy );

		} );

		// --- second pass: anisotropic Kuwahara filter -------------------------

		const kuwahara = Fn( () => {

			const { texel, load } = inputTexel();

			// The tensor pass renders at the resolution of the input, so this is
			// the tensor of exactly this fragment.

			const structureTensor = textureLoad( structureTensorTex, texel ).toConst( 'structureTensor' );

			const dxdx = structureTensor.x;
			const dxdy = structureTensor.y;
			const dydy = structureTensor.w;

			// Eigenvalues of the structure tensor, from section "3.1 Orientation
			// and Anisotropy Estimation".

			const eigenvalueFirstTerm = dxdx.add( dydy ).div( 2 );
			const eigenvalueSquareRootTerm = dxdx.sub( dydy ).pow2().add( dxdy.pow2().mul( 4 ) ).sqrt().div( 2 );
			const firstEigenvalue = eigenvalueFirstTerm.add( eigenvalueSquareRootTerm ).toConst( 'firstEigenvalue' );
			const secondEigenvalue = eigenvalueFirstTerm.sub( eigenvalueSquareRootTerm ).toConst( 'secondEigenvalue' );

			// Normalized eigenvector oriented along the direction of minimum rate
			// of change. Degenerate (isotropic) neighborhoods fall back to the x
			// axis, the direction is arbitrary there anyway.

			const eigenvector = vec2( firstEigenvalue.sub( dxdx ), dxdy.negate() );
			const eigenvectorLength = eigenvector.length();
			const unitEigenvector = eigenvectorLength.greaterThan( 0 )
				.select( eigenvector.div( eigenvectorLength ), vec2( 1, 0 ) ).toConst( 'unitEigenvector' );

			// Anisotropy in the [ 0, 1 ] range, where 0 is fully isotropic.

			const eigenvalueSum = firstEigenvalue.add( secondEigenvalue );
			const anisotropy = eigenvalueSum.greaterThan( 0 )
				.select( firstEigenvalue.sub( secondEigenvalue ).div( eigenvalueSum ), float( 0 ) ).toConst( 'anisotropy' );

			// An ellipse that is elongated along the dominant direction for high
			// anisotropy and circular for low anisotropy.

			const radius = this.radius.max( EPSILON ).toConst( 'radius' );
			const eccentricity = this.eccentricity.max( EPSILON );
			const ellipseWidthFactor = eccentricity.add( anisotropy ).div( eccentricity );
			const ellipseWidth = ellipseWidthFactor.mul( radius ).toConst( 'ellipseWidth' );
			const ellipseHeight = radius.div( ellipseWidthFactor ).toConst( 'ellipseHeight' );

			// Since the eigenvector is normalized, its components are the cosine
			// and sine of the angle it makes with the x axis.

			const cosine = unitEigenvector.x;
			const sine = unitEigenvector.y;

			// Inverse transform of that ellipse, mapping it onto a unit disk.
			// Matrices are filled in column-major order.

			const inverseEllipseMatrix = mat2(
				cosine.div( ellipseWidth ), sine.negate().div( ellipseHeight ),
				sine.div( ellipseWidth ), cosine.div( ellipseHeight )
			).toConst( 'inverseEllipseMatrix' );

			// Axis aligned bounding box of the zero centered ellipse, see
			// https://iquilezles.org/articles/ellipses/. Only the upper bound is
			// needed, the lower bound is its negation.

			const ellipseMajorAxis = ellipseWidth.mul( unitEigenvector );
			const ellipseMinorAxis = ellipseHeight.mul( unitEigenvector.yx ).mul( vec2( - 1, 1 ) );
			const ellipseBounds = ivec2( ellipseMajorAxis.pow2().add( ellipseMinorAxis.pow2() ).sqrt().ceil() ).toConst( 'ellipseBounds' );

			// Overlap polynomial parameters for the eight sector ellipse, from
			// section "3 Alternative Weighting Functions" of the polynomial
			// weights paper.

			const sectorCenterOverlap = float( 2 ).div( radius ).toConst( 'sectorCenterOverlap' );
			const crossSectorOverlap = sectorCenterOverlap.add( SECTOR_ENVELOPE_COS ).div( SECTOR_ENVELOPE_SIN_SQUARED ).toConst( 'crossSectorOverlap' );

			// The center texel is exempt from the loop below, so its contribution
			// is accumulated up front. Its zero coordinates collapse the sector
			// weighting to a uniform 1 / SECTOR_COUNT.

			const centerColor = load( texel ).toConst( 'centerColor' );
			const centerWeight = 1 / SECTOR_COUNT;

			const colorSums = [];
			const squaredColorSums = [];
			const weightSums = [];

			for ( let i = 0; i < SECTOR_COUNT; i ++ ) {

				colorSums.push( vec3( centerColor.rgb.mul( centerWeight ) ).toVar( 'colorSum' + i ) );
				squaredColorSums.push( vec3( centerColor.rgb.pow2().mul( centerWeight ) ).toVar( 'squaredColorSum' + i ) );
				weightSums.push( float( centerWeight ).toVar( 'weightSum' + i ) );

			}

			// Ellipses are mirror symmetric about their center, so only the upper
			// half of the bounding box is walked and each point is accumulated
			// together with its mirror, sharing one weight computation.

			Loop( { start: int( 0 ), end: ellipseBounds.y, name: 'y', condition: '<=' }, ( { y } ) => {

				Loop( { start: ellipseBounds.x.negate(), end: ellipseBounds.x, name: 'x', condition: '<=' }, ( { x } ) => {

					// Points on the horizontal axis with a negative x are the
					// mirrors of points already visited, and the center has
					// already been accumulated above.

					If( y.equal( int( 0 ) ).and( x.lessThanEqual( int( 0 ) ) ), () => {

						Continue();

					} );

					// Map the point into the unit disk, discarding anything that
					// falls outside the ellipse.

					const diskPoint = inverseEllipseMatrix.mul( vec2( float( x ), float( y ) ) ).toConst( 'diskPoint' );
					const diskPointLengthSquared = diskPoint.dot( diskPoint ).toConst( 'diskPointLengthSquared' );

					If( diskPointLengthSquared.greaterThan( 1 ), () => {

						Continue();

					} );

					// Sectors overlap, so a point contributes to more than one of
					// them. Rotating the disk point by 90 degrees is a swap and a
					// negation, and the y term of the polynomial is squared and so
					// insensitive to sign, which gives the four even weights
					// directly. The odd weights are the same expression evaluated
					// at the point rotated by 45 degrees.

					const sectorWeights = [];

					const polynomial = sectorCenterOverlap.sub( crossSectorOverlap.mul( diskPoint.pow2() ) ).toConst( 'polynomial' );

					sectorWeights[ 0 ] = diskPoint.y.add( polynomial.x ).max( 0 ).pow2();
					sectorWeights[ 2 ] = diskPoint.x.negate().add( polynomial.y ).max( 0 ).pow2();
					sectorWeights[ 4 ] = diskPoint.y.negate().add( polynomial.x ).max( 0 ).pow2();
					sectorWeights[ 6 ] = diskPoint.x.add( polynomial.y ).max( 0 ).pow2();

					const rotatedDiskPoint = vec2( diskPoint.x.sub( diskPoint.y ), diskPoint.x.add( diskPoint.y ) ).mul( Math.SQRT1_2 ).toConst( 'rotatedDiskPoint' );
					const rotatedPolynomial = sectorCenterOverlap.sub( crossSectorOverlap.mul( rotatedDiskPoint.pow2() ) ).toConst( 'rotatedPolynomial' );

					sectorWeights[ 1 ] = rotatedDiskPoint.y.add( rotatedPolynomial.x ).max( 0 ).pow2();
					sectorWeights[ 3 ] = rotatedDiskPoint.x.negate().add( rotatedPolynomial.y ).max( 0 ).pow2();
					sectorWeights[ 5 ] = rotatedDiskPoint.y.negate().add( rotatedPolynomial.x ).max( 0 ).pow2();
					sectorWeights[ 7 ] = rotatedDiskPoint.x.add( rotatedPolynomial.y ).max( 0 ).pow2();

					// Attenuate points further from the sector center, and fold the
					// normalization of the sector weights into the same term. The
					// sum is guarded because a zero sum would otherwise produce a
					// NaN that spreads across the whole accumulator.

					let sectorWeightsSum = sectorWeights[ 0 ];

					for ( let i = 1; i < SECTOR_COUNT; i ++ ) {

						sectorWeightsSum = sectorWeightsSum.add( sectorWeights[ i ] );

					}

					const radialGaussianWeight = diskPointLengthSquared.mul( - Math.PI ).exp()
						.div( sectorWeightsSum.max( EPSILON ) ).toConst( 'radialGaussianWeight' );

					const upperColor = load( texel.add( ivec2( x, y ) ) ).rgb.toConst( 'upperColor' );
					const lowerColor = load( texel.sub( ivec2( x, y ) ) ).rgb.toConst( 'lowerColor' );
					const upperColorSquared = upperColor.pow2().toConst( 'upperColorSquared' );
					const lowerColorSquared = lowerColor.pow2().toConst( 'lowerColorSquared' );

					for ( let i = 0; i < SECTOR_COUNT; i ++ ) {

						const weight = sectorWeights[ i ].mul( radialGaussianWeight ).toConst( 'sectorWeight' + i );

						weightSums[ i ].addAssign( weight );
						colorSums[ i ].addAssign( upperColor.mul( weight ) );
						squaredColorSums[ i ].addAssign( upperColorSquared.mul( weight ) );

						// The mirrored point belongs to the opposing sector.

						const opposing = ( i + SECTOR_COUNT / 2 ) % SECTOR_COUNT;

						weightSums[ opposing ].addAssign( weight );
						colorSums[ opposing ].addAssign( lowerColor.mul( weight ) );
						squaredColorSums[ opposing ].addAssign( lowerColorSquared.mul( weight ) );

					}

				} );

			} );

			// Combine the sector means, giving the sectors with the lowest
			// standard deviation the most influence. The threshold on the standard
			// deviation avoids a division by zero and the artifacts that an
			// unbounded weight produces in homogeneous regions.

			const sumOfWeights = float( 0 ).toVar( 'sumOfWeights' );
			const weightedSum = vec3( 0 ).toVar( 'weightedSum' );

			for ( let i = 0; i < SECTOR_COUNT; i ++ ) {

				const colorMean = colorSums[ i ].div( weightSums[ i ] ).toConst( 'colorMean' + i );
				const squaredColorMean = squaredColorSums[ i ].div( weightSums[ i ] );
				const colorVariance = squaredColorMean.sub( colorMean.pow2() ).abs();

				const standardDeviation = colorVariance.sqrt().dot( vec3( 1 ) );
				const weight = float( 1 ).div( standardDeviation.max( 0.02 ).pow( this.sharpness ) ).toConst( 'sectorMeanWeight' + i );

				sumOfWeights.addAssign( weight );
				weightedSum.addAssign( colorMean.mul( weight ) );

			}

			// A sufficiently high sharpness combined with a high standard
			// deviation can drive every weight to zero, in which case the original
			// color is the only sensible answer.

			const color = sumOfWeights.greaterThan( 0 )
				.select( weightedSum.div( sumOfWeights.max( EPSILON ) ), centerColor.rgb );

			return vec4( color, centerColor.a );

		} );

		//

		const structureTensorMaterial = this._structureTensorMaterial || ( this._structureTensorMaterial = new NodeMaterial() );
		structureTensorMaterial.contextNode = context( builder.getSharedContext() );
		structureTensorMaterial.fragmentNode = computeStructureTensor();
		structureTensorMaterial.name = 'Kuwahara_StructureTensor';
		structureTensorMaterial.needsUpdate = true;

		const kuwaharaMaterial = this._kuwaharaMaterial || ( this._kuwaharaMaterial = new NodeMaterial() );
		kuwaharaMaterial.contextNode = context( builder.getSharedContext() );
		kuwaharaMaterial.fragmentNode = kuwahara();
		kuwaharaMaterial.name = 'Kuwahara_Anisotropic';
		kuwaharaMaterial.needsUpdate = true;

		//

		const properties = builder.getNodeProperties( this );
		properties.textureNode = textureNode;

		//

		return this._textureNode;

	}

	/**
	 * Frees internal resources. This method should be called
	 * when the effect is no longer required.
	 */
	dispose() {

		this._structureTensorRT.dispose();
		this._outputRT.dispose();

		if ( this._structureTensorMaterial !== null ) {

			this._structureTensorMaterial.dispose();
			this._structureTensorMaterial = null;

		}

		if ( this._kuwaharaMaterial !== null ) {

			this._kuwaharaMaterial.dispose();
			this._kuwaharaMaterial = null;

		}

		super.dispose();

	}

}

export default KuwaharaFilterNode;

/**
 * TSL function for creating an anisotropic Kuwahara filter node for post processing.
 *
 * @tsl
 * @function
 * @param {Node<vec4>} node - The node that represents the input of the effect.
 * @param {(number|Node<float>)} [radius=5] - The radius of the filter kernel in pixels.
 * @param {(number|Node<float>)} [sharpness=8] - How strongly the lowest variance sector dominates.
 * @param {(number|Node<float>)} [eccentricity=2] - How far the kernel may stretch in anisotropic regions.
 * @returns {KuwaharaFilterNode}
 */
export const kuwaharaFilter = ( node, radius, sharpness, eccentricity ) => new KuwaharaFilterNode( convertToTexture( node ), radius, sharpness, eccentricity );
