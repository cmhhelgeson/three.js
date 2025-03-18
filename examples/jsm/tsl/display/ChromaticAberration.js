import { Fn, float, uv, Loop, int, If, normalize, sqrt, vec3, pow, viewportResolution, screenSize, clamp, vec4, vec2 } from 'three/tsl';

/**
 * Applies a chromatic aberration effect to the given input node.
 *
 * @tsl
 * @function
 * @param {Node<vec4>} inputNode - The input node to apply the chromatic aberration to.
 * @param {Node<float>} amount - The amount of aberration
 * @param {Node<float>} radialIntensity - The motion vectors of the beauty pass.
 * @param {Node<vec2>} [direction] - How many samples the effect should use. A higher value results in better quality but is also more expensive.
  * @param {Node<vec2>} [centerPosition] - How many samples the effect should use. A higher value results in better quality but is also more expensive.
 * @return {Node<vec4>} The input node with the chromatic aberration effect applied.
 */
export const chromaticAberration = /*@__PURE__*/ Fn( ( [
	inputNode,
	amount = float( 30.0 ),
	radialIntensity = float( 0.0 ),
	directionX = float( - 0.707 ),
	directionY = float( - 0.707 ),
	centerPosition = vec2( 0.5, 0.5 )
] ) => {

	const sampleColor = ( uv ) => inputNode.sample( uv );

	const uvs = uv();

	const colorResult = sampleColor( uvs ).toVar();

	const direction = vec2( directionX, directionY ).toVar();

	const screenPos = colorResult.sub( centerPosition );
	const effectDirection = direction.toVar();
	If( direction.x.equal( 0 ).and( direction.y.equal( 0 ) ), () => {

		effectDirection.assign( normalize( screenPos ) );

	} );

	const screenXSq = screenPos.x.mul( screenPos.x );
	const screenYSq = screenPos.y.mul( screenPos.y );
	const radius2 = screenXSq.add( screenYSq );

	const radius = sqrt( radius2 );

	const refIndices = vec3( - 0.3, 0.0, 0.3 );

	const refShiftX = amount.mul( pow( radius, radialIntensity ) ).mul( effectDirection.x ).mul( effectDirection.x.div( screenSize.x ) );
	const refShiftY = amount.mul( pow( radius, radialIntensity ) ).mul( effectDirection.y ).mul( effectDirection.y.div( screenSize.y ) );

	const uvR = vec2(
		uvs.x.add( refIndices.r.mul( refShiftX ) ),
		uvs.y.add( refIndices.r.mul( refShiftY ).mul( 0.5 ) )
	);

	const uvG = vec2(
		uvs.x.add( refIndices.g.mul( refShiftX ) ),
		uvs.y.add( refIndices.g.mul( refShiftY ).mul( 0.5 ) )
	);

	const uvB = vec2(
		uvs.x.add( refIndices.b.mul( refShiftX ) ),
		uvs.y.add( refIndices.b.mul( refShiftY ).mul( 0.5 ) )
	);

	const r = sampleColor( uvR );
	const g = sampleColor( uvG );
	const b = sampleColor( uvB );

	const a = clamp( r.a.add( g.a ).add( b.a ), 0.0, 1.0 );

	colorResult.assign( vec4( r.r, g.g, b.b, a ) );

	return colorResult;

} );
