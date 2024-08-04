import PassNode from './PassNode';
import { uv } from '../accessors/UVNode.js';
import { addNodeElement, tslFn, nodeObject, float, int, vec2, vec3, vec4, If } from '../shadernode/ShaderNode.js';

import { loop } from '../utils/LoopNode';
import { floor, EPSILON } from '../math/MathNode';
import { velocity } from '../accessors/VelocityNode';
import { output } from '../core/PropertyNode.js';
import { mrt } from '../core/MRTNode.js';
import { NodeUpdateType } from '../core/constants.js';



const genHalton = ( base, index ) => {

	let result = 0.0;
	let f = 1.0;
	let i = index;
	while ( i > 0 ) {

		f /= base;
		result += f * ( i % base );
		i = Math.floor( i / base );

	}

	return result;

};

// TODO: May need license from
const generateHalton2x3Sequence = ( sequenceLength ) => {

	const sequence = new Array( sequenceLength * 2 );
	for ( let i = 0; i < sequenceLength; i ++ ) {

		const u = genHalton( 2, i + 1 ) - 0.5;
		const v = genHalton( 3, i + 1 ) - 0.5;
		sequence[ 2 * i + 0 ] = u;
		sequence[ 2 * i + 1 ] = v;

	}

	return sequence;

};

// http://twvideo01.ubm-us.net/o1/vault/gdc2016/Presentations/Pedersen_LasseJonFuglsang_TemporalReprojectionAntiAliasing.pdf
//
class TRAAPassNode extends PassNode {

	constructor( scene, camera, options ) {

		super( 'color', scene, camera, options );

		this.depthKernelSize = 3;
		this.jitterIndex = 0;
		this.jitterSequence = generateHalton2x3Sequence( 16 );
		console.log( this.jitterSequence );

		this.prevRenderTarget = this.renderTarget.clone();

		this._mrt = mrt( {
			output: output,
			velocity: velocity
		} );

		this.updateAfterType = NodeUpdateType.FRAME;

	}


	updateAfter( frame ) {

		this.prevRenderTarget.copy( this.renderTarget );

		// Access next jitter position
		this.jitterIndex += 1;
		this.jitterIndex = this.jitterIndex % 16;

		console.log( this.renderTarget.width );

		const jitterX = this.jitterSequence[ 2 * this.jitterIndex + 0 ];
		const jitterY = this.jitterSequence[ 2 * this.jitterIndex + 1 ];

		this.camera.setViewOffset( this.renderTarget.width, this.renderTarget.height, jitterX, jitterY, this.renderTarget.width, this.renderTarget.height );

		//super.updateAfter( frame );

	}




	setup() {


		/*const currentVelocity = super.getTextureNode( 'velocity' );
		const prevVelocity = super.getTextureNode( 'prevVelocity' );

		const sampleDepth = ( uv ) => this.depthNode.uv( uv ).x;

		const dmin = vec3( 0, 0, 0 );

		const k_feedback = float( 0.0 );

		const velocityLength = length( currentVelocity.sub( previousVelocity ) ).div( texelSize );
		const saturateVelocity = saturate( velocityLength.div( 10.0 ) );

		k_feedback.mulAssign( saturateVelocity );

		const calcMinMax = ( cNeighbors, tNeighbors, count, truth, cMin, cMax ) => {

			cMin = vec4( 2, 2, 2, 2 );
			cMax = vec4( - 2, - 2, - 2, - 2 );

			const foundColor = bool( false );
			const foundAlpha = bool( false );

			const centerTransparent = truth.a.greaterThan( EPSILON );
			loop( { start: int( 0 ), end: int( count ), type: 'int', condition: '<' }, ( { i } ) => {

				const pixelTransparent = transp.element( i ).a.greaterThan( EPSILON );
				If( centerTransparent.equal( pixelTransparent ), () => {

					const min_ = min( cMin, colors.element( i ) );
					const max_ = max( cMax, colors.element( i ) );

					const foundAlpha = bool( true );

					If( colors.element( i ).a.greaterThan( 0.5 ), () => {

						cMin.assign( min_ );
						cMax.assign( max_ );

						foundColor.assign( true );

					} ).else( () => {

						cMin.a.assign( min_.a );
						cMax.a.assign( max_.a );

					} );

				} );


			} );

			return foundColor;

		};

		const clipAABB = ( aabbMin, aabbMax, p ) => {






		};

		const calculateTAA = ( uvNode, currentVelocity ) => {

			const _FeedbackMin = minSampleWeight.mul( 2.0 ).oneMinus();
			const _FeedbackMax = minSampleWeight.oneMinus();



		};

		loop( { start: int( 0 ), end: int( this.kernelSize * this.kernelSize ), type: 'int', condition: '<' }, ( { i } ) => {

			const xOffset = - 1 + i.remainder( 3 );
			const yOffset = 1 - floor( i.div( 3 ) );

			const depth = sampleDepth( uv().add( vec2( xOffset, yOffset ).mul( texelSize ) ) );
			If( depth.lessThan( dmin.z ), () => {

				dmin.x = xOffset;
				dmin.y = yOffset;
				dmin.z = depth;

			} );

		} );

		return vec3( uv.add( texelSize.xy.mul( dmin.xy ) ), dmin.z ); */

	}



}

export default TRAAPassNode;

export const traaPass = ( scene, camera, options ) => nodeObject( new TRAAPassNode( scene, camera, options ) );
addNodeElement( 'traaPass', traaPass );
