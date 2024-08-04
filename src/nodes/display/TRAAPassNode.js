import PassNode, { passTexture } from './PassNode';
import { uv } from '../accessors/UVNode.js';
import { addNodeElement, tslFn, nodeObject, float, int, vec2, vec3, vec4, If } from '../shadernode/ShaderNode.js';
import { mix, step } from '../math/MathNode';
import { viewportTopLeft } from './ViewportNode.js';

import { velocity } from '../accessors/VelocityNode';
import { output } from '../core/PropertyNode.js';
import { mrt } from '../core/MRTNode.js';
import { Vector2 } from '../../math/Vector2.js';
import { texture } from '../accessors/TextureNode.js';



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

const _size = /*@__PURE__*/ new Vector2();

class TRAAPassNode extends PassNode {

	constructor( scene, camera, options ) {

		super( 'color', scene, camera, options );

		this.depthKernelSize = 3;
		this.jitterIndex = 0;
		this.jitterSequence = generateHalton2x3Sequence( 16 );

		this.blendingFactor = 0.2;

		this._mrt = mrt( {
			output: output,
			velocity: velocity
		} );

		this._historyRT = this.renderTarget.clone();
		this._historyTextureNode = passTexture( this, this._historyRT.texture );

		this.textureNodeOld = texture();

	}

	setSize( width, height ) {

		this._width = width;
		this._height = height;

		const effectiveWidth = this._width * this._pixelRatio;
		const effectiveHeight = this._height * this._pixelRatio;

		this.renderTarget.setSize( effectiveWidth, effectiveHeight );
		this._historyRT.setSize( effectiveWidth, effectiveHeight );

	}



	updateBefore( frame ) {

		const { renderer } = frame;
		const { scene, camera } = this;

		this._pixelRatio = renderer.getPixelRatio();
		const size = renderer.getSize( _size );
		this.setSize( size.width, size.height );

		// Access next jitter position
		this.jitterIndex += 1;
		this.jitterIndex = this.jitterIndex % 16;

		const jitterX = this.jitterSequence[ 2 * this.jitterIndex + 0 ];
		const jitterY = this.jitterSequence[ 2 * this.jitterIndex + 1 ];

		this.camera.setViewOffset( this.renderTarget.width, this.renderTarget.height, jitterX * 1000, jitterY * 1000, this.renderTarget.width, this.renderTarget.height );

		this._cameraNear.value = camera.near;
		this._cameraFar.value = camera.far;

		const currentRenderTarget = renderer.getRenderTarget();
		const currentMRT = renderer.getMRT();

		this._historyRT.copy( this.renderTarget );

		this.textureNodeOld.value = this._historyRT.texture;

		renderer.setRenderTarget( this.renderTarget );
		renderer.setMRT( this._mrt );
		renderer.render( scene, camera );

		// Swap render targets
		const temp = this._historyRT;
		this._historyRT = this.renderTarget;
		this.renderTarget = temp;

		renderer.setRenderTarget( currentRenderTarget );
		renderer.setMRT( currentMRT );

		//super.updateAfter( frame );

	}





	setup() {

		const both = tslFn( () => {

			const output = super.getTextureNode( 'output' );
			const prevTexture = this._historyTextureNode;

			const out = mix( output.renderOutput(), output, step( 0.5, viewportTopLeft.x ) );
			const prev = mix( out, prevTexture, step( 1.0, viewportTopLeft.x ) );

			return prev;

		} );

		const output = both();

		return output;



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

	dispose() {

		this.renderTarget.dispose();
		this._historyRT.dispose();

	}

}

export default TRAAPassNode;

export const traaPass = ( scene, camera, options ) => nodeObject( new TRAAPassNode( scene, camera, options ) );
addNodeElement( 'traaPass', traaPass );

/*class AfterImageNode extends TempNode {

	constructor( textureNode, damp = 0.96 ) {

		super( textureNode );

		this.textureNode = textureNode;
		this.textureNodeOld = texture();
		this.damp = uniform( damp );

		this._compRT = new RenderTarget();
		this._compRT.texture.name = 'AfterImageNode.comp';

		this._oldRT = new RenderTarget();
		this._oldRT.texture.name = 'AfterImageNode.old';

		this._textureNode = passTexture( this, this._compRT.texture );

		this.updateBeforeType = NodeUpdateType.RENDER;

	}

	getTextureNode() {

		return this._textureNode;

	}

	setSize( width, height ) {

		this._compRT.setSize( width, height );
		this._oldRT.setSize( width, height );

	}

	updateBefore( frame ) {

		const { renderer } = frame;

		const textureNode = this.textureNode;
		const map = textureNode.value;

		const textureType = map.type;

		this._compRT.texture.type = textureType;
		this._oldRT.texture.type = textureType;

		renderer.getDrawingBufferSize( _size );

		this.setSize( _size.x, _size.y );

		const currentRenderTarget = renderer.getRenderTarget();
		const currentTexture = textureNode.value;

		this.textureNodeOld.value = this._oldRT.texture;

		// comp
		renderer.setRenderTarget( this._compRT );
		_quadMeshComp.render( renderer );

		// Swap the textures
		const temp = this._oldRT;
		this._oldRT = this._compRT;
		this._compRT = temp;

		renderer.setRenderTarget( currentRenderTarget );
		textureNode.value = currentTexture;

	}

	setup( builder ) {

		const textureNode = this.textureNode;
		const textureNodeOld = this.textureNodeOld;

		//

		const uvNode = textureNode.uvNode || uv();

		textureNodeOld.uvNode = uvNode;

		const sampleTexture = ( uv ) => textureNode.uv( uv );

		const when_gt = tslFn( ( [ x_immutable, y_immutable ] ) => {

			const y = float( y_immutable ).toVar();
			const x = vec4( x_immutable ).toVar();

			return max( sign( x.sub( y ) ), 0.0 );

		} );

		const afterImg = tslFn( () => {

			const texelOld = vec4( textureNodeOld );
			const texelNew = vec4( sampleTexture( uvNode ) );

			texelOld.mulAssign( this.damp.mul( when_gt( texelOld, 0.1 ) ) );
			return max( texelNew, texelOld );

		} );

		//

		const materialComposed = this._materialComposed || ( this._materialComposed = builder.createNodeMaterial() );
		materialComposed.fragmentNode = afterImg();

		_quadMeshComp.material = materialComposed;

		//

		const properties = builder.getNodeProperties( this );
		properties.textureNode = textureNode;

		//

		return this._textureNode;

	}

	dispose() {

		this._compRT.dispose();
		this._oldRT.dispose();

	}

}

export const afterImage = ( node, damp ) => nodeObject( new AfterImageNode( nodeObject( node ).toTexture(), damp ) );

addNodeElement( 'afterImage', afterImage );

export default AfterImageNode; */
