import TempNode from '../core/TempNode.js';
import { texture, textureLoad } from '../accessors/TextureNode.js';
import { uv } from '../accessors/UVNode.js';
import { addNodeElement, nodeObject, tslFn, vec2, vec3, vec4, float, If } from '../shadernode/ShaderNode.js';
import { uniform } from '../core/UniformNode.js';
import { Vector2 } from '../../math/Vector2.js';
import { Matrix4 } from '../../math/Matrix4.js';
import { length, min, exp } from '../math/MathNode.js';
import { loop } from '../utils/LoopNode.js';
import QuadMesh from '../../renderers/common/QuadMesh.js';
import { RenderTarget } from '../../core/RenderTarget.js';
import { Color } from '../../math/Color.js';
import {
	AdditiveBlending,
	DoubleSide,
	MeshDepthMaterial,
	NoBlending,
	RGBADepthPacking,
} from 'three';
import PassNode, { passTexture } from './PassNode.js';
import MeshBasicNodeMaterial from '../materials/MeshBasicNodeMaterial.js';
import { BackSide, FrontSide } from '../../constants.js';
import { DepthTexture } from '../../textures/DepthTexture.js';
import { NodeUpdateType } from '../core/constants.js';

const _quadMesh = new QuadMesh();
const _currentClearColor = new Color();
const _debugQuadMesh = new QuadMesh();
const _size = new Vector2();

const MAX_EDGE_THICKNESS = 4;
const MAX_EDGE_GLOW = 4;

class OutlinePassTestNode extends PassNode {

	constructor( scene, camera, resolution, selectedObjects, uniformObject, debugTexture = null ) {

		super( 'color', scene, camera );

		// Create resources for handling selected objects
		this.selectedObjects = selectedObjects !== undefined ? selectedObjects : [];
		this._visibilityCache = new Map();

		this.updateBeforeType = NodeUpdateType.RENDER;

		this.resolution = ( resolution !== undefined ) ? new Vector2( resolution.x, resolution.y ) : new Vector2( 256, 256 );

		const resx = Math.round( this.resolution.x / this.downSampleRatio );
		const resy = Math.round( this.resolution.y / this.downSampleRatio );

		// User-adjusted uniforms

		this.visibleEdgeColor = uniformObject.visibleEdgeColor || vec3( 1, 1, 1 );
		this.hiddenEdgeColor = uniformObject.hiddenEdgeColor || vec3( 0.1, 0.04, 0.02 );
		this.edgeGlow = uniformObject.edgeGlow || 0.0;
		this.usePatternTexture = uniformObject.usePatternTexture || 0;
		this.edgeThickness = uniformObject.edgeThickness || 1.0;
		this.edgeStrength = uniformObject.edgeStrength || 3.0;
		this.downSampleRatio = uniformObject.downSampleRatio || 2;
		this.pulsePeriod = uniformObject.pulsePeriod || 0;

		// Internal uniforms ( per Output Pass )

		this._invSize = uniform( vec2( 0.5, 0.5 ) );

		// Interal uniforms ( per Output Pass Step )

		this._kernelRadius = uniform( 1.0 );
		this._texSize = uniform( new Vector2() );
		this._blurDirection = uniform( new Vector2() );
		this._textureMatrix = uniform( new Matrix4() );


		// Materials

		//this.prepareMaskMaterial = this.getPrepareMaskMaterial();
		//this.prepareMaskMaterial.side = DoubleSide;
		//this.prepareMaskMaterial.fragmentShader = replaceDepthToViewZ( this.prepareMaskMaterial.fragmentShader, this.renderCamera );

		this._debugMaterial = null;


		// RENDER TARGETS

		// Non selected objects depth pass

		this._nonSelectedRT = new RenderTarget( this.resolution.x, this.resolution.y );
		this._nonSelectedRT.texture.name = 'OutlinePassNode.nonSelected_color';
		this._textures[ this._nonSelectedRT.texture.name ] = this._nonSelectedRT;

		const nonSelectedDepthTexture = new DepthTexture();
		nonSelectedDepthTexture.name = 'OutlinePassNode.nonSelected_depth';
		nonSelectedDepthTexture.isRenderTargetTexture = true;
		this._nonSelectedRT.depthTexture = nonSelectedDepthTexture;
		this._textures[ this._nonSelectedRT.depthTexture.name ] = this._nonSelectedRT.depthTexture;

		/*this._maskRT = new RenderTarget( this.resolution.x, this.resolution.y );
		this._maskRT.name = 'OutlinePassNode.mask';

		this._maskDownSampleRT = new RenderTarget( resx, resy );
		this._maskDownSampleRT.texture.name = 'OutlinePassNode.depthDownSample';

		this._blurRT1 = new RenderTarget( resx, resy );
		this._blurRT1.texture.name = 'OutlinePassNode.blur1';
		this._blurRT2 = new RenderTarget( Math.round( resx / 2 ), Math.round( resy / 2 ) );
		this._blurRT2.texture.name = 'OutlinePassNode.blur2';

		this._edgeDetectionRT1 = new RenderTarget( resx, resy );
		this._edgeDetectionRT1.texture.name = 'OutlinePassNode.edge1';
		this._edgeDetectionRT2 = new RenderTarget( Math.round( resx / 2 ), Math.round( resy / 2 ) );
		this._edgeDetectionRT2.texture.name = 'OutlinePassNode.edge2'; */

		//this._outputRT = new RenderTarget();
		// edgeDetectionMaterialQuad

		// Overlay material
		//this.overlayMaterial = this.getOverlayMaterial();

		// copy material


		//this.enabled = true;
		//this.needsSwap = false;

		this._returnTexture = passTexture( this, debugTexture === null ? this._nonSelectedRT.depthTexture : this._textures[ debugTexture ] );

		this._oldClearColor = new Color();
		this.oldClearAlpha = 1;

		function replaceDepthToViewZ( string, camera ) {

			const type = camera.isPerspectiveCamera ? 'perspective' : 'orthographic';

			return string.replace( /DEPTH_TO_VIEW_Z/g, type + 'DepthToViewZ' );

		}

	}

	changeVisibilityOfSelectedObjects( bVisible ) {

		const cache = this._visibilityCache;

		function gatherSelectedMeshesCallBack( object ) {

			if ( object.isMesh ) {

				if ( bVisible === true ) {

					object.visible = cache.get( object );

				} else {

					cache.set( object, object.visible );
					object.visible = bVisible;

				}

			}

		}

		for ( let i = 0; i < this.selectedObjects.length; i ++ ) {

			const selectedObject = this.selectedObjects[ i ];
			selectedObject.traverse( gatherSelectedMeshesCallBack );

		}

	}

	changeVisibilityOfNonSelectedObjects( bVisible ) {

		const cache = this._visibilityCache;
		const selectedMeshes = [];

		function gatherSelectedMeshesCallBack( object ) {

			if ( object.isMesh ) selectedMeshes.push( object );

		}

		for ( let i = 0; i < this.selectedObjects.length; i ++ ) {

			const selectedObject = this.selectedObjects[ i ];
			selectedObject.traverse( gatherSelectedMeshesCallBack );

		}

		function VisibilityChangeCallBack( object ) {

			if ( object.isMesh || object.isSprite ) {

				// only meshes and sprites are supported by OutlinePass

				let bFound = false;

				for ( let i = 0; i < selectedMeshes.length; i ++ ) {

					const selectedObjectId = selectedMeshes[ i ].id;

					if ( selectedObjectId === object.id ) {

						bFound = true;
						break;

					}

				}

				if ( bFound === false ) {

					const visibility = object.visible;

					if ( bVisible === false || cache.get( object ) === true ) {

						object.visible = bVisible;

					}

					cache.set( object, visibility );

				}

			} else if ( object.isPoints || object.isLine ) {

				// the visibilty of points and lines is always set to false in order to
				// not affect the outline computation

				if ( bVisible === true ) {

					object.visible = cache.get( object ); // restore

				} else {

					cache.set( object, object.visible );
					object.visible = bVisible;

				}

			}

		}

		this.renderScene.traverse( VisibilityChangeCallBack );

	}

	updateBefore( frame ) {

		// Necessary render setup before each pass
		// Typical PassNode setup

		const { renderer } = frame;
		const { scene, camera } = this;

		this._pixelRatio = renderer.getPixelRatio();

		const size = renderer.getSize( _size );

		this.setSize( size.width, size.height );

		const currentRenderTarget = renderer.getRenderTarget();
		const currentMRT = renderer.getMRT();

		this._cameraNear.value = camera.near;
		this._cameraFar.value = camera.far;

		// Store old clear values

		//renderer.getClearColor( this._oldClearColor );
		//this.oldClearAlpha = renderer.getClearAlpha();
		//const oldAutoClear = renderer.autoClear;

		// Modify clear values

		//renderer.autoClear = false;
		renderer.setClearColor( 0xffffff, 1 );

		// Make selected objects invisible

		this.changeVisibilityOfSelectedObjects( false );

		//const currentBackground = this.scene.background;
		//this.scene.background = null;

		//const oldOverrideMaterial = this.scene.overrideMaterial;

		//this.scene.overrideMaterial = new MeshBasicNodeMaterial();
		//this.scene.overrideMaterial.side = DoubleSide;
		//this.scene.overrideMaterial.blending = NoBlending;

		renderer.setRenderTarget( this._nonSelectedRT );
		renderer.setMRT( null );

		//renderer.autoClear = false;

		renderer.render( scene, camera );

		//this.scene.overrideMaterial = oldOverrideMaterial;

		//renderer.setClearColor( this._oldClearColor, this.oldClearAlpha );
		//renderer.autoClear = oldAutoClear;

		renderer.setRenderTarget( this.renderTarget );
		renderer.setMRT( this._mrt );

		renderer.render( scene, camera );

		renderer.setRenderTarget( currentRenderTarget );
		renderer.setMRT( currentMRT );

	}

	setSize( width, height ) {

		this._width = width;
		this._height = height;

		const effectiveWidth = this._width * this._pixelRatio;
		const effectiveHeight = this._height * this._pixelRatio;

		this.renderTarget.setSize( effectiveWidth, effectiveHeight );
		this._nonSelectedRT.setSize( effectiveWidth, effectiveHeight );

		/*let resx = Math.round( width / this.downSampleRatio );
		let resy = Math.round( height / this.downSampleRatio );

		this._maskDownSampleRT.setSize( resx, resy );
		this._blurRT1.setSize( resx, resy );
		this._edgeDetectionRT1.setSize( resx, resy );
		this._blurRT2.setSize( Math.round( resx / 2 ), Math.round( resy / 2 ) );
		this._edgeDetectionRT2.setSize( Math.round( resx / 2 ), Math.round( resy / 2 ) ); */

	}

	updateTextureMatrix() {

		this.textureMatrix.set( 0.5, 0.0, 0.0, 0.5,
			0.0, 0.5, 0.0, 0.5,
			0.0, 0.0, 0.5, 0.5,
			0.0, 0.0, 0.0, 1.0 );
		this.textureMatrix.multiply( this.renderCamera.projectionMatrix );
		this.textureMatrix.multiply( this.renderCamera.matrixWorldInverse );

	}

	getPrepareMaskMaterial() {

	}

	setup( builder ) {

		return texture( this._nonSelectedRT.depthTexture );

	}

	/* setup( builder ) {

		// TSL Utility Functions
		gaussianPdf = ( x, sigma ) => {

			const sigma2 = sigma.mul( sigma );
			const x2 = x.mul( x );

			return float( 0.39894 ).mul( exp( -0.5.mul( x2 ).div( sigma2 ) ) ).div( sigma );

		}

		const edgeDetection = tslFn(() => {

			const maskTexture = float( 1.0 );
			const texSize = vec2( 0.5, 0.5 );
			const visibleEdgeColor = vec3( 1.0, 1.0, 1.0 );
			const hiddenEdgeColor = vec3( 1.0, 1.0, 1.0 );

			const invSize = float( 1.0 ).div( texSize );
			const uvOffset = vec4( 1.0, 0.0, 0.0, 1.0 ).mul( vec4( invSize, invSize ) );
			const c1 = textureSample( maskTexture, uvTextureNode.add( uvOffset.xy ) );
			const c2 = textureSample( maskTexture, uvTextureNode.sub( uvOffset.xy ) );
			const c3 = textureSample( maskTexture, uvTextureNode.add( uvOffset.yw ) );
			const c4 = textureSample( maskTexture, uvTextureNode.sub( uvOffset.yw ) );
			const diff1 = float( 0.5 ).mul( c1.r.sub( c2.r ) );
			const diff2 = float( 0.5 ).mul( c3.r.sub( c4.r ) );
			const d = length( vec2( diff1, diff2 ) );
			const a1 = min( c1.g, c2.g );
			const a2 = min( c3.g, c4.g );
			const visibilityFactor = min( a1, a2 );
			// Potentially, make 0.001 a uniform that modifies the condition
			const edgeColorCondition = visibilityFactor.add( -1.0 ).greaterThan( 0.001 );

			const edgeColor = edgeColorCondition.cond( visibleEdgeColor, hiddenEdgeColor );

			return vec4( edgeColor, 1.0 ).mul( vec4( d ) );

		} );


		const separableBlur = tslFn( () => {

			const sigma = this._kernelRadius.div( 2.0 );
			const weightSum = gaussianPdf( 0.0, sigma );
			const diffuseSum = textureSample().mul( weightSum );
			const delta = this._blurDirection.mul( this._invSize ).mul( this._kernelRadius.div( float( MAX_RADIUS ) ) );
			const uvOffset = delta;

			loop(() => {
				const x = this._kernelRadius.mul( float( i ) ).div( float( MAX_RADIUS ) );
				const w = gaussianPdf( x, sigma );
				const sample1 = textureSample( uv().add( uvOffset ) );
				const sample2 = textureSample( uv().sub( uvOffset) );
				diffuseSum.addAssign( w.mul( sample1.add( sample2 ) ) );
				weightSum.addAssign( w.mul( 2.0 ) );
				uvOffset.addAssign( delta );
			} );

			return diffuseSum.div( weightSum );

		}	);

		const getOverlay = tslFn(() => {

			const maskTexture = textureNode;
			const edgeTexture1 = texture( this._edgeDetectionRT1.texture );
			const edgeTexture2 = texture( this._edgeDetectionRT2.texture );
			const patternTexture = texture( this.patternTexture.texture );
			const edgeStrength = uniform( 1.0 );
			const edgeGlow = uniform( 1.0 );
			const usePatternTexture = uniform( 0 );

			const edgeValue1 = edgeTexture1.uv( edgeTexture1.uvNode );
			const edgeValue2 = edgeTexture2.uv( edgeTexture2.uvNode );
			const maskColor = maskTexture.uv( maskTexture.uvNode );
			const patternColor = patternTexture.uv( patternTexture.uvNode.mul( 6.0 ) );
			const visibilityFactor = float( 1.0 ).sub( maskColor.g ).greaterThan( 0.0 ).cond( 1.0, 0.5 );
			const edgeValue = edgeValue1.add( edgeValue2.mul( edgeGlow ) );
			const finalColor = edgeStrength.mul( maskColor.r ).mul( edgeGlow );
			If( usePatternTexture, () => {

				finalColor.addAssign( visibilityFactor.mul( float( 1.0 ).sub( maskColor.r ) ).mul( float( 1.0 ).sub( patternColor.r ) ) );

			})

			return finalColor;

		// material.depthTest = false;
		// material.depthWrite = false
		// material.blending = AdditiveBlending
		// material.transparent = true;

		});

		const color = super.getTextureNode( 'output' );

		return color;

	}  */

}

OutlinePassNode.BlurDirectionX = new Vector2( 1.0, 0.0 );
OutlinePassNode.BlurDirectionY = new Vector2( 0.0, 1.0 );

export const outlinePass = ( scene, camera, resolution, selectedObjects, uniformObject ) => nodeObject( new OutlinePassNode( scene, camera, resolution, selectedObjects, uniformObject ) );

addNodeElement( 'outlinePass', outlinePass );

export default OutlinePassTestNode;


