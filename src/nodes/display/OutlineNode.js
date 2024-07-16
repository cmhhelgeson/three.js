import TempNode from '../core/TempNode.js';
import { texture } from '../accessors/TextureNode.js';
import { textureSize } from '../accessors/TextureSizeNode.js';
import { uv } from '../accessors/UVNode.js';
import { addNodeElement, nodeObject, tslFn, mat3, vec2, vec3, vec4, float, int, If } from '../shadernode/ShaderNode.js';
import { NodeUpdateType } from '../core/constants.js';
import { uniform } from '../core/UniformNode.js';
import { DataTexture } from '../../textures/DataTexture.js';
import { Vector2 } from '../../math/Vector2.js';
import { Vector3 } from '../../math/Vector3.js';
import { PI, cos, sin, pow, clamp, abs, max, mix, sqrt, acos, dot, normalize, cross, length, min, exp } from '../math/MathNode.js';
import { div, mul, add, sub } from '../math/OperatorNode.js';
import { loop } from '../utils/LoopNode.js';
import QuadMesh from '../../renderers/common/QuadMesh.js';
import { RenderTarget } from '../../core/RenderTarget.js';
import { Color } from '../../math/Color.js';

const _quadMesh = new QuadMesh();
const _currentClearColor = new Color();

import {
	AdditiveBlending,
	Color,
	DoubleSide,
	HalfFloatType,
	Matrix4,
	MeshDepthMaterial,
	NoBlending,
	RGBADepthPacking,
	ShaderMaterial,
	UniformsUtils,
	Vector2,
	Vector3,
	WebGLRenderTarget
} from 'three';
import { Pass, FullScreenQuad } from './Pass.js';
import { CopyShader } from '../shaders/CopyShader.js';

const MAX_EDGE_THICKNESS = 4;
const MAX_EDGE_GLOW = 4;

class OutlineNode extends TempNode {

	constructor( resolution, selectedObjects, uniformObject ) {

		super();

		this.selectedObjects = selectedObjects !== undefined ? selectedObjects : [];
		this._visibilityCache = new Map();

		this.resolution = ( resolution !== undefined ) ? new Vector2( resolution.x, resolution.y ) : new Vector2( 256, 256 );

		const resx = Math.round( this.resolution.x / this.downSampleRatio );
		const resy = Math.round( this.resolution.y / this.downSampleRatio );

		// User-adjusted uniforms

		this.visibleEdgeColor = uniformObject.visibleEdgeColor || vec3(1, 1, 1);
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

		this.separableBlurMaterial1 = this.getSeperableBlurMaterial( MAX_EDGE_THICKNESS );
		this.separableBlurMaterial1.uniforms[ 'texSize' ].value.set( resx, resy );
		this.separableBlurMaterial1.uniforms[ 'kernelRadius' ].value = 1;
		this.separableBlurMaterial2 = this.getSeperableBlurMaterial( MAX_EDGE_GLOW );
		this.separableBlurMaterial2.uniforms[ 'texSize' ].value.set( Math.round( resx / 2 ), Math.round( resy / 2 ) );
		this.separableBlurMaterial2.uniforms[ 'kernelRadius' ].value = MAX_EDGE_GLOW;


		this._invSize.set( float(1.0).div(this.texSize))

		// Render blur 1

		this._texSize.value = vec2( resx, resy );

		// Render blur 2

		this._texSize.value = vec2( resx, resy );


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

	updateTextureMatrix() {

		this.textureMatrix.set( 0.5, 0.0, 0.0, 0.5,
			0.0, 0.5, 0.0, 0.5,
			0.0, 0.0, 0.5, 0.5,
			0.0, 0.0, 0.0, 1.0 );
		this.textureMatrix.multiply( this.renderCamera.projectionMatrix );
		this.textureMatrix.multiply( this.renderCamera.matrixWorldInverse );

	}

	render( renderer, writeBuffer, readBuffer, deltaTime, maskActive ) {

		if ( this.selectedObjects.length > 0 ) {

			renderer.getClearColor( this._oldClearColor );
			this.oldClearAlpha = renderer.getClearAlpha();
			const oldAutoClear = renderer.autoClear;

			renderer.autoClear = false;

			if ( maskActive ) renderer.state.buffers.stencil.setTest( false );

			renderer.setClearColor( 0xffffff, 1 );

			// Make selected objects invisible
			this.changeVisibilityOfSelectedObjects( false );

			const currentBackground = this.renderScene.background;
			this.renderScene.background = null;

			// 1. Draw Non Selected objects in the depth buffer
			this.renderScene.overrideMaterial = this.depthMaterial;
			renderer.setRenderTarget( this.renderTargetDepthBuffer );
			renderer.clear();
			renderer.render( this.renderScene, this.renderCamera );

			// Make selected objects visible
			this.changeVisibilityOfSelectedObjects( true );
			this._visibilityCache.clear();

			// Update Texture Matrix for Depth compare
			this.updateTextureMatrix();

			// Make non selected objects invisible, and draw only the selected objects, by comparing the depth buffer of non selected objects
			this.changeVisibilityOfNonSelectedObjects( false );
			this.renderScene.overrideMaterial = this.prepareMaskMaterial;
			this.prepareMaskMaterial.uniforms[ 'cameraNearFar' ].value.set( this.renderCamera.near, this.renderCamera.far );
			this.prepareMaskMaterial.uniforms[ 'depthTexture' ].value = this.renderTargetDepthBuffer.texture;
			this.prepareMaskMaterial.uniforms[ 'textureMatrix' ].value = this.textureMatrix;
			renderer.setRenderTarget( this.renderTargetMaskBuffer );
			renderer.clear();
			renderer.render( this.renderScene, this.renderCamera );
			this.renderScene.overrideMaterial = null;
			this.changeVisibilityOfNonSelectedObjects( true );
			this._visibilityCache.clear();

			this.renderScene.background = currentBackground;

			// 2. Downsample to Half resolution
			this.fsQuad.material = this.materialCopy;
			this.copyUniforms[ 'tDiffuse' ].value = this.renderTargetMaskBuffer.texture;
			renderer.setRenderTarget( this.renderTargetMaskDownSampleBuffer );
			renderer.clear();
			this.fsQuad.render( renderer );

			this.tempPulseColor1.copy( this.visibleEdgeColor );
			this.tempPulseColor2.copy( this.hiddenEdgeColor );

			if ( this.pulsePeriod > 0 ) {

				const scalar = ( 1 + 0.25 ) / 2 + Math.cos( performance.now() * 0.01 / this.pulsePeriod ) * ( 1.0 - 0.25 ) / 2;
				this.tempPulseColor1.multiplyScalar( scalar );
				this.tempPulseColor2.multiplyScalar( scalar );

			}

			// 3. Apply Edge Detection Pass
			this.fsQuad.material = this.edgeDetectionMaterial;
			this.edgeDetectionMaterial.uniforms[ 'maskTexture' ].value = this.renderTargetMaskDownSampleBuffer.texture;
			this.edgeDetectionMaterial.uniforms[ 'texSize' ].value.set( this.renderTargetMaskDownSampleBuffer.width, this.renderTargetMaskDownSampleBuffer.height );
			this.edgeDetectionMaterial.uniforms[ 'visibleEdgeColor' ].value = this.tempPulseColor1;
			this.edgeDetectionMaterial.uniforms[ 'hiddenEdgeColor' ].value = this.tempPulseColor2;
			renderer.setRenderTarget( this.renderTargetEdgeBuffer1 );
			renderer.clear();
			this.fsQuad.render( renderer );

			// 4. Apply Blur on Half res
			this.fsQuad.material = this.separableBlurMaterial1;
			this.separableBlurMaterial1.uniforms[ 'colorTexture' ].value = this.renderTargetEdgeBuffer1.texture;
			this.separableBlurMaterial1.uniforms[ 'direction' ].value = OutlinePass.BlurDirectionX;
			this.separableBlurMaterial1.uniforms[ 'kernelRadius' ].value = this.edgeThickness;
			renderer.setRenderTarget( this.renderTargetBlurBuffer1 );
			renderer.clear();
			this.fsQuad.render( renderer );
			this.separableBlurMaterial1.uniforms[ 'colorTexture' ].value = this.renderTargetBlurBuffer1.texture;
			this.separableBlurMaterial1.uniforms[ 'direction' ].value = OutlinePass.BlurDirectionY;
			renderer.setRenderTarget( this.renderTargetEdgeBuffer1 );
			renderer.clear();
			this.fsQuad.render( renderer );

			// Apply Blur on quarter res
			this.fsQuad.material = this.separableBlurMaterial2;
			this.separableBlurMaterial2.uniforms[ 'colorTexture' ].value = this.renderTargetEdgeBuffer1.texture;
			this.separableBlurMaterial2.uniforms[ 'direction' ].value = OutlinePass.BlurDirectionX;
			renderer.setRenderTarget( this.renderTargetBlurBuffer2 );
			renderer.clear();
			this.fsQuad.render( renderer );
			this.separableBlurMaterial2.uniforms[ 'colorTexture' ].value = this.renderTargetBlurBuffer2.texture;
			this.separableBlurMaterial2.uniforms[ 'direction' ].value = OutlinePass.BlurDirectionY;
			renderer.setRenderTarget( this.renderTargetEdgeBuffer2 );
			renderer.clear();
			this.fsQuad.render( renderer );

			// Blend it additively over the input texture
			this.fsQuad.material = this.overlayMaterial;
			this.overlayMaterial.uniforms[ 'maskTexture' ].value = this.renderTargetMaskBuffer.texture;
			this.overlayMaterial.uniforms[ 'edgeTexture1' ].value = this.renderTargetEdgeBuffer1.texture;
			this.overlayMaterial.uniforms[ 'edgeTexture2' ].value = this.renderTargetEdgeBuffer2.texture;
			this.overlayMaterial.uniforms[ 'patternTexture' ].value = this.patternTexture;
			this.overlayMaterial.uniforms[ 'edgeStrength' ].value = this.edgeStrength;
			this.overlayMaterial.uniforms[ 'edgeGlow' ].value = this.edgeGlow;
			this.overlayMaterial.uniforms[ 'usePatternTexture' ].value = this.usePatternTexture;


			if ( maskActive ) renderer.state.buffers.stencil.setTest( true );

			renderer.setRenderTarget( readBuffer );
			this.fsQuad.render( renderer );

			renderer.setClearColor( this._oldClearColor, this.oldClearAlpha );
			renderer.autoClear = oldAutoClear;

		}

		if ( this.renderToScreen ) {

			this.fsQuad.material = this.materialCopy;
			this.copyUniforms[ 'tDiffuse' ].value = readBuffer.texture;
			renderer.setRenderTarget( null );
			this.fsQuad.render( renderer );

		}

	}

	getPrepareMaskMaterial() {

		return new ShaderMaterial( {

			uniforms: {
				'depthTexture': { value: null },
				'cameraNearFar': { value: new Vector2( 0.5, 0.5 ) },
				'textureMatrix': { value: null }
			},

			vertexShader:
				`#include <morphtarget_pars_vertex>
				#include <skinning_pars_vertex>

				varying vec4 projTexCoord;
				varying vec4 vPosition;
				uniform mat4 textureMatrix;

				void main() {

					#include <skinbase_vertex>
					#include <begin_vertex>
					#include <morphtarget_vertex>
					#include <skinning_vertex>
					#include <project_vertex>

					vPosition = mvPosition;

					vec4 worldPosition = vec4( transformed, 1.0 );

					#ifdef USE_INSTANCING

						worldPosition = instanceMatrix * worldPosition;

					#endif
					
					worldPosition = modelMatrix * worldPosition;

					projTexCoord = textureMatrix * worldPosition;

				}`,

			fragmentShader:
				`#include <packing>
				varying vec4 vPosition;
				varying vec4 projTexCoord;
				uniform sampler2D depthTexture;
				uniform vec2 cameraNearFar;

				void main() {

					float depth = unpackRGBAToDepth(texture2DProj( depthTexture, projTexCoord ));
					float viewZ = - DEPTH_TO_VIEW_Z( depth, cameraNearFar.x, cameraNearFar.y );
					float depthTest = (-vPosition.z > viewZ) ? 1.0 : 0.0;
					gl_FragColor = vec4(0.0, depthTest, 1.0, 1.0);

				}`

		} );

	}

 	getEdgeDetectionMaterial = tslFn(() => {

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

	})

	gaussianPdf = ( x, sigma ) => {

		const sigma2 = sigma.mul( sigma );
		const x2 = x.mul( x );

		return float( 0.39894 ).mul( exp( -0.5.mul( x2 ).div( sigma2 ) ) ).div( sigma );

	}

	getSeperableBlurMaterial = tslFn( () => {
		
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
		})

		return diffuseSum.div( weightSum );
		
	})

	getSeperableBlurMaterial( maxRadius ) {

		return new ShaderMaterial( {

			defines: {
				'MAX_RADIUS': maxRadius,
			},

			uniforms: {
				'colorTexture': { value: null },
				'texSize': { value: new Vector2( 0.5, 0.5 ) },
				'direction': { value: new Vector2( 0.5, 0.5 ) },
				'kernelRadius': { value: 1.0 }
			},

			vertexShader:
				`varying vec2 vUv;

				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,

			fragmentShader:
				`#include <common>
				varying vec2 vUv;
				uniform sampler2D colorTexture;
				uniform vec2 texSize;
				uniform vec2 direction;
				uniform float kernelRadius;

				float gaussianPdf(in float x, in float sigma) {
					return 0.39894 * exp( -0.5 * x * x/( sigma * sigma))/sigma;
				}

				void main() {
					vec2 invSize = 1.0 / texSize;
					float sigma = kernelRadius/2.0;
					float weightSum = gaussianPdf(0.0, sigma);
					vec4 diffuseSum = texture2D( colorTexture, vUv) * weightSum;
					vec2 delta = direction * invSize * kernelRadius/float(MAX_RADIUS);
					vec2 uvOffset = delta;
					for( int i = 1; i <= MAX_RADIUS; i ++ ) {
						float x = kernelRadius * float(i) / float(MAX_RADIUS);
						float w = gaussianPdf(x, sigma);
						vec4 sample1 = texture2D( colorTexture, vUv + uvOffset);
						vec4 sample2 = texture2D( colorTexture, vUv - uvOffset);
						diffuseSum += ((sample1 + sample2) * w);
						weightSum += (2.0 * w);
						uvOffset += delta;
					}
					gl_FragColor = diffuseSum/weightSum;
				}`
		} );

	}

	getOverlayMaterial = tslFn(() => {

		const maskTexture = float( 1.0 );
		const edgeTexture1 = float( 1.0 );
		const edgeTexture2 = float( 1.0 );
		const patternTexture = float( 1.0 );
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

	})

}

OutlinePass.BlurDirectionX = new Vector2( 1.0, 0.0 );
OutlinePass.BlurDirectionY = new Vector2( 0.0, 1.0 );

export { OutlinePass };

