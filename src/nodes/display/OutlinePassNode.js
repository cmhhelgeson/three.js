import TempNode from '../core/TempNode.js';
import { texture } from '../accessors/TextureNode.js';
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
	Color,
	DoubleSide,
	Matrix4,
	MeshDepthMaterial,
	NoBlending,
	RGBADepthPacking,
	ShaderMaterial,
	UniformsUtils,
} from 'three';

import { CopyShader } from '../shaders/CopyShader.js';

const _quadMesh = new QuadMesh();
const _currentClearColor = new Color();

const MAX_EDGE_THICKNESS = 4;
const MAX_EDGE_GLOW = 4;

class OutlinePassNode extends PassNode {

	constructor( resolution, selectedObjects, uniformObject ) {

		super();

		this.selectedObjects = selectedObjects !== undefined ? selectedObjects : [];
		this._visibilityCache = new Map();

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
		this._texSize = unifrom( new Vector2() )
		this._blurDirection = uniform( new Vector2() );

		this._maskRT = new RenderTarget( this.resolution.x, this.resolution.y );
		this._maskRT.name = 'OutlineNode.mask';
		this.renderTargetMaskBuffer.texture.generateMipmaps = false;

		this.depthMaterial = new MeshDepthMaterial();
		this.depthMaterial.side = DoubleSide;
		this.depthMaterial.depthPacking = RGBADepthPacking;
		this.depthMaterial.blending = NoBlending;

		this.prepareMaskMaterial = this.getPrepareMaskMaterial();
		this.prepareMaskMaterial.side = DoubleSide;
		this.prepareMaskMaterial.fragmentShader = replaceDepthToViewZ( this.prepareMaskMaterial.fragmentShader, this.renderCamera );

		this._maskDownSampleRT = new RenderTarget( resx, resy );
		this._maskDownSampleRT.texture.name = 'OutlineNode.depthDownSample';

		this._blurRT1 = new RenderTarget( resx, resy );
		this._blurRT1.texture.name = 'OutlineNode.blur1';
		this._blurRT2 = new RenderTarget( Math.round( resx / 2 ), Math.round( resy / 2 ) );
		this._blurRT2.texture.name = 'OutlineNode.blur2';

		this._edgeDetectionRT1 = new RenderTarget( resx, resy );
		this._edgeDetectionRT.texture.name = 'OutlineNode.edge1';
		this._edgeDetectionRT2 = new RenderTarget( Math.round( resx / 2 ), Math.round( resy / 2 ) );
		this._edgeDetectionRT2.texture.name = 'OutlineNode.edge2';

		this._outputRT = new RenderTarget();
		// edgeDetectionMaterialQuad

		// Overlay material
		this.overlayMaterial = this.getOverlayMaterial();

		// copy material

		const copyShader = CopyShader;

		this.copyUniforms = UniformsUtils.clone( copyShader.uniforms );

		this.materialCopy = new ShaderMaterial( {
			uniforms: this.copyUniforms,
			vertexShader: copyShader.vertexShader,
			fragmentShader: copyShader.fragmentShader,
			blending: NoBlending,
			depthTest: false,
			depthWrite: false
		} );

		this.enabled = true;
		this.needsSwap = false;

		this._oldClearColor = new Color();
		this.oldClearAlpha = 1;

		this.fsQuad = new FullScreenQuad( null );

		this.tempPulseColor1 = new Color();
		this.tempPulseColor2 = new Color();
		this.textureMatrix = new Matrix4();

		function replaceDepthToViewZ( string, camera ) {

			const type = camera.isPerspectiveCamera ? 'perspective' : 'orthographic';

			return string.replace( /DEPTH_TO_VIEW_Z/g, type + 'DepthToViewZ' );

		}

	}

	updateBefore( frame ) {

		// Necessary render setup before each pass

		const { renderer } = frame;

		const textureNode = this.textureNode;
		const map = textureNode.value;

		const currentRenderTarget = renderer.getRenderTarget();
		const currentMRT = renderer.getMRT();
		renderer.getClearColor( _currentClearColor );
		const currentClearAlpha = renderer.getClearAlpha();

		const currentTexture = textureNode.value;

		// 1. Draw Non Selected objects in the depth buffer

		// 2. Downsample to Half resolution


		textureNode.value = this._maskRT.texture;

		// 3. Apply Edge Detection Pass

		textureNode.value = this._maskDownSampleRT.texture;
		this._texSize.value = vec2( this._maskDownSampleRT.texture.image.width, this._maskDownSampleRT.texture.image.height );
		renderer.setRenderTarget( this._edgeDetectionRT1 );

		// 4. Apply Blur in X direction
		textureNode.value = this._edgeDetectionRT1.texture;
		this._blurDirection.value = OutlinePass.BlurDirectionX;
		this._kernelRadius.value = this.edgeThickness;
		renderer.setRenderTarget( this._blurRT1);

		// 5. Apply Blur in Y Direction
		textureNode.value = this._blurRT1.texture;
		this._blurDirection.value = OutlinePass.BlurDirectionY;
		renderer.setRenderTarget( this._edgeDetectionRT1 );

		// Second blur pass x
		textureNode.value = this._edgeDetectionRT1.texture;
		this._blurDirection.value = OutlinePass.BlurDirectionX;
		renderer.setRenderTarget( this._blurRT2 );

		// Second blur pass y
		textureNode.value = this._blurRT2.texture;
		this._blurDirection.value = OutlinePass.BlurDirectionY;
		renderer.setRenderTarget( this._edgeDetectionRT2 );

		// Blend passes additively over the input texture
		textureNode.value = this._maskRT.texture;
		renderer.setRenderTarget( this._outputRT );
		
		// Revert
		renderer.setRenderTarget( currentTexture );
		renderer.setMRT( currentMRT );

	}

	setSize( width, height ) {

		let resx = Math.round( width / this.downSampleRatio );
		let resy = Math.round( height / this.downSampleRatio );

		this.renderTargetMaskBuffer.setSize( width, height );
		this.renderTargetDepthBuffer.setSize( width, height );
		this._maskDownSampleRT.setSize( resx, resy );
		this._blurRT1.setSize( resx, resy );
		this._edgeDetectionRT1.setSize( resx, resy );
		this._blurRT2.setSize( Math.round( resx / 2 ), Math.round( resy / 2 ) );
		this._edgeDetectionRT2.setSize( Math.round( resx / 2 ), Math.round( resy / 2 ) );

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

	}

}

OutlinePass.BlurDirectionX = new Vector2( 1.0, 0.0 );
OutlinePass.BlurDirectionY = new Vector2( 0.0, 1.0 );

export { OutlinePass };

export const outlinePass = ( node, directionNode, sigma ) => nodeObject( new GaussianBlurNode( nodeObject( node ).toTexture(), directionNode, sigma ) );

addNodeElement( 'outlinePass', outlinePass );

export default OutlinePassNode;


