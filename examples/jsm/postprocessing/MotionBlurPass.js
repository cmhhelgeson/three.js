/**
 * @author Garrett Johnson / http://gkjohnson.github.io/
 *
 *  Approach from http://john-chapman-graphics.blogspot.com/2013/01/per-object-motion-blur.html
 */
import {
	Frustum,
	Color,
	WebGLRenderTarget,
	LinearFilter,
	RGBFormat,
	HalfFloatType,
	Matrix4,
	DataTexture,
	RGBAFormat,
	FloatType,
	ShaderMaterial,
	RepeatWrapping,
	UniformsUtils,
} from 'three';
import { Pass, FullScreenQuad } from './Pass.js';
import { GeometryShader } from '../shaders/GeometryShader.js';
import { CompositeShader } from '../shaders/CompositeShader.js';
import { MotionBlurShader } from '../shaders/MotionBlurShader.js';


class RendererState {

	constructor() {

		this.clearAlpha = 0;
		this.clearColor = new Color();
		this.renderTarget = null;
		//this.outputEncoding = LinearEncoding;
		this.overrideMaterial = null;
		this.shadowsEnabled = false;

		this.autoClear = true;
		this.autoClearColor = true;
		this.autoClearDepth = true;
		this.autoClearStencil = true;

		this.background = null;
		this.autoUpdate = true;

	}

	copy( renderer, scene ) {

		if ( renderer ) {

			this.clearAlpha = renderer.getClearAlpha();
			this.clearColor = renderer.getClearColor( this.clearColor );
			this.renderTarget = renderer.getRenderTarget();

			this.shadowsEnabled = renderer.shadowMap.enabled;
			//this.outputEncoding = renderer.outputEncoding;
			this.autoClear = renderer.autoClear;
			this.autoClearColor = renderer.autoClearColor;
			this.autoClearDepth = renderer.autoClearDepth;
			this.autoClearStencil = renderer.autoClearStencil;

		}

		if ( scene ) {

			this.overrideMaterial = scene.overrideMaterial;
			this.background = scene.background;
			this.autoUpdate = scene.autoUpdate;

		}

	}

	restore( renderer, scene ) {

		if ( renderer ) {

			renderer.setClearAlpha( this.clearAlpha );
			renderer.setClearColor( this.clearColor );
			renderer.setRenderTarget( this.renderTarget );

			renderer.shadowMap.enabled = this.shadowsEnabled;
			//renderer.outputEncoding = this.outputEncoding;
			renderer.autoClear = this.autoClear;
			renderer.autoClearColor = this.autoClearColor;
			renderer.autoClearDepth = this.autoClearDepth;
			renderer.autoClearStencil = this.autoClearStencil;

		}

		if ( scene ) {

			scene.overrideMaterial = this.overrideMaterial;
			scene.background = this.background;
			scene.autoUpdate = this.autoUpdate;

		}

		this.renderTarget = null;
		this.overrideMaterial = null;

	}

}

function traverseVisibleMeshes( currentMesh, callback ) {

	if ( currentMesh.visible ) {

		if ( currentMesh.isMesh || currentMesh.isSkinnedMesh ) {

			callback( currentMesh );

		}

		const children = currentMesh.children;
		for ( let i = 0, l = children.length; i < l; i ++ ) {

			traverseVisibleMeshes( children[ i ], callback );

		}

	}

}

const _blackColor = new Color( 0, 0, 0 );
const _defaultOverrides = {};
const _rendererState = new RendererState();


export class MotionBlurPass extends Pass {

	get enabled() {

		return this._enabled;

	}

	set enabled( val ) {

		if ( val === false ) {

			this._prevPosMap.clear();
			this._cameraMatricesNeedInitializing = true;

		}

		this._enabled = val;

	}

	constructor( scene, camera, options = {} ) {

		super();

		this.enabled = true;
		this.needsSwap = true;

		// settings
		this.samples = 'samples' in options ? options.samples : 15;
		this.expandGeometry = 'expandGeometry' in options ? options.expandGeometry : 0;
		this.interpolateGeometry = 'interpolateGeometry' in options ? options.interpolateGeometry : 1;
		this.smearIntensity = 'smearIntensity' in options ? options.smearIntensity : 1;
		this.blurTransparent = 'blurTransparent' in options ? options.blurTransparent : false;
		this.renderCameraBlur = 'renderCameraBlur' in options ? options.renderCameraBlur : true;
		this.renderTargetScale = 'renderTargetScale' in options ? options.renderTargetScale : 1;
		this.jitter = 'jitter' in options ? options.jitter : 1;
		this.jitterStrategy = 'jitterStrategy' in options ? options.jitterStrategy : MotionBlurPass.RANDOM_JITTER;

		this.debug = {

			display: MotionBlurPass.DEFAULT,
			dontUpdateState: false

		};

		this.scene = scene;
		this.camera = camera;

		this.firstUpdate = true;

		// list of positions from previous frames
		this._prevPosMap = new Map();
		this._currentFrameMod = 0;
		this._frustum = new Frustum();
		this._projScreenMatrix = new Matrix4();
		this._cameraMatricesNeedInitializing = true;

		this._prevCamProjection = new Matrix4();
		this._prevCamWorldInverse = new Matrix4();

		// render targets
		this._velocityBuffer =
			new WebGLRenderTarget( 256, 256, {
				minFilter: LinearFilter,
				magFilter: LinearFilter,
				format: RGBAFormat,
				type: HalfFloatType
			} );
		this._velocityBuffer.texture.name = 'MotionBlurPass.Velocity';
		this._velocityBuffer.texture.generateMipmaps = false;

		this._compositeMaterial = new ShaderMaterial( CompositeShader );
		this._compositeQuad = new FullScreenQuad( this._compositeMaterial );

		this.fsQuad = new FullScreenQuad();

	}

	// Pass API
	dispose() {

		this._compositeQuad.dispose();
		this._velocityBuffer.dispose();
		this._prevPosMap.clear();

	}

	setSize( width, height ) {

		const renderTargetScale = this.renderTargetScale;
		const velocityBuffer = this._velocityBuffer;
		velocityBuffer.setSize( width * renderTargetScale, height * renderTargetScale );

	}

	render( renderer, writeBuffer, readBuffer ) {

		const debug = this.debug;
		const scene = this.scene;
		const camera = this.camera;
		const compositeQuad = this._compositeQuad;
		const finalBuffer = this.renderToScreen ? null : writeBuffer;

		// Getthe clear values
		_rendererState.copy( renderer, scene );

		// Set the clear state
		renderer.autoClear = false;
		renderer.setClearColor( _blackColor, 0 );

		// TODO: This is getting called just to set 'currentRenderState' in the renderer
		// NOTE -- why do we need this?

		renderer.compile( scene, camera );



		this._ensurePrevCameraTransform();

		switch ( debug.display ) {

			case MotionBlurPass.GEOMETRY: {

				renderer.setRenderTarget( finalBuffer );
				renderer.clear();
				this._drawAllMeshes( renderer, MotionBlurPass.GEOMETRY, ! debug.dontUpdateState );
				break;

			}

			case MotionBlurPass.VELOCITY: {

				renderer.setRenderTarget( finalBuffer );
				renderer.clear();
				this._drawAllMeshes( renderer, MotionBlurPass.VELOCITY, ! debug.dontUpdateState );
				break;

			}

			case MotionBlurPass.DEFAULT: {

				const velocityBuffer = this._velocityBuffer;
				renderer.setRenderTarget( velocityBuffer );
				renderer.clear();
				this._drawAllMeshes( renderer, MotionBlurPass.VELOCITY, ! debug.dontUpdateState );

				this._compositeMaterial.uniforms[ 'sourceBuffer' ].value = readBuffer.texture;
				this._compositeMaterial.uniforms[ 'velocityBuffer' ].value = this._velocityBuffer.texture;
				this._compositeMaterial.uniforms[ 'jitter' ].value = this.jitter;

				if ( this._compositeMaterial.defines.SAMPLES !== this.samples ) {

					this._compositeMaterial.defines.SAMPLES = Math.max( 0, Math.floor( this.samples ) );
					this._compositeMaterial.needsUpdate = true;

				}

				if ( this._compositeMaterial.defines.JITTER_STRATEGY !== this.jitterStrategy ) {

					this._compositeMaterial.defines.JITTER_STRATEGY = this.jitterStrategy;
					this._compositeMaterial.needsUpdate = true;

				}

				renderer.setRenderTarget( finalBuffer );
				compositeQuad.render( renderer );

				break;

			}

		}

		// Save the camera state for the next frame
		this._prevCamWorldInverse.copy( camera.matrixWorldInverse );
		this._prevCamProjection.copy( camera.projectionMatrix );

		// Restore renderer settings
		_rendererState.restore( renderer, scene );

	}

	// Returns the set of previous frames data for object position and bone state. Creates
	// a new object this with frames state if it hasn't been created yet.
	_getPreviousFrameState( obj ) {

		const prevPosMap = this._prevPosMap;
		let data = prevPosMap.get( obj );
		if ( data === undefined ) {

			data = {

				lastUsedFrame: - 1,
				matrixWorld: obj.matrixWorld.clone(),
				geometryMaterial: new ShaderMaterial( {
					name: GeometryShader.name,
					uniforms: UniformsUtils.clone( GeometryShader.uniforms ),
					vertexShader: GeometryShader.vertexShader,
					fragmentShader: GeometryShader.fragmentShader,
				} ),
				velocityMaterial: new ShaderMaterial( {
					name: MotionBlurShader.name,
					uniforms: UniformsUtils.clone( MotionBlurShader.uniforms ),
					vertexShader: MotionBlurShader.vertexShader,
					fragmentShader: MotionBlurShader.fragmentShader,
				} ),
				boneMatrices: null,
				boneTexture: null,

			};


			prevPosMap.set( obj, data );

		}


		const isSkinned = Boolean( obj.type === 'SkinnedMesh' && obj.skeleton && obj.skeleton.bones && obj.skeleton.boneMatrices );
		// Possibly being used in a shader, but seems like it's just being used as a boolean to set a define in the WebGLProgram?
		//const isSkinned = obj.type === 'SkinnedMesh' && obj.skeleton && obj.skeleton.bones && obj.skeleton.boneMatrices;

		data.geometryMaterial.skinning = isSkinned;
		data.velocityMaterial.skinning = isSkinned;

		// copy the skeleton state into the prevBoneTexture uniform
		const skeleton = obj.skeleton;
		const boneTextureNeedsUpdate = data.boneMatrices === null || data.boneMatrices.length !== skeleton.boneMatrices.length;

		// If the mesh is skinned and if a boneTexture has yet to be assigned,
		// Assign current boneTexture to previous frame. Then just swap them between frames
		if ( isSkinned && boneTextureNeedsUpdate ) {

			const boneMatrices = new Float32Array( skeleton.boneMatrices.length );
			boneMatrices.set( skeleton.boneMatrices );
			data.boneMatrices = boneMatrices;

			const size = Math.sqrt( skeleton.boneMatrices.length / 4 );
			const boneTexture = new DataTexture( boneMatrices, size, size, RGBAFormat, FloatType );
			boneTexture.needsUpdate = true;

			data.geometryMaterial.uniforms.prevBoneTexture.value = boneTexture;
			data.velocityMaterial.uniforms.prevBoneTexture.value = boneTexture;
			data.boneTexture = boneTexture;

		}

		return data;

	}

	// saves the current state to be used next frame
	_saveCurrentObjectState( obj ) {

		const prevPosMap = this._prevPosMap;
		const data = prevPosMap.get( obj );

		if ( data.boneMatrices !== null ) {

			data.boneMatrices.set( obj.skeleton.boneMatrices );
			data.boneTexture.needsUpdate = true;

		}

		data.matrixWorld.copy( obj.matrixWorld );

	}

	// Draw all meshes in the scene and discard those that are no longer being used
	_drawAllMeshes( renderer, type, saveState ) {

		this._currentFrameMod = ( this._currentFrameMod + 1 ) % 2;
		const thisFrameId = this._currentFrameMod;
		const prevPosMap = this._prevPosMap;

		traverseVisibleMeshes( this.scene, mesh => {

			this._drawMesh( renderer, mesh, type, saveState );
			if ( prevPosMap.has( mesh ) ) {

				prevPosMap.get( mesh ).lastUsedFrame = thisFrameId;

			}

		} );

		prevPosMap.forEach( ( data, mesh ) => {

			if ( data.lastUsedFrame !== thisFrameId ) {

				data.geometryMaterial.dispose();
				data.velocityMaterial.dispose();
				if ( data.boneTexture ) {

					data.boneTexture.dispose();

				}

				prevPosMap.delete( mesh );

			}

		} );

	}


	_drawMesh( renderer, mesh, type, saveState ) {

		const overrides = mesh.motionBlur || _defaultOverrides;
		let blurTransparent = this.blurTransparent;
		let renderCameraBlur = this.renderCameraBlur;
		let expandGeometry = this.expandGeometry;
		let interpolateGeometry = this.interpolateGeometry;
		let smearIntensity = this.smearIntensity;

		blurTransparent = 'blurTransparent' in overrides ? overrides.blurTransparent : this.blurTransparent;
		renderCameraBlur = 'renderCameraBlur' in overrides ? overrides.renderCameraBlur : this.renderCameraBlur;
		expandGeometry = 'expandGeometry' in overrides ? overrides.expandGeometry : this.expandGeometry;
		interpolateGeometry = 'interpolateGeometry' in overrides ? overrides.interpolateGeometry : this.interpolateGeometry;
		smearIntensity = 'smearIntensity' in overrides ? overrides.smearIntensity : this.smearIntensity;

		const isTransparent = mesh.material.transparent || mesh.material.alpha < 1;
		const isCulled = mesh.frustumCulled && ! this._frustum.intersectsObject( mesh );
		const skip = blurTransparent === false && isTransparent || isCulled;

		if ( skip ) {

			if ( this._prevPosMap.has( mesh ) && saveState ) {

				this._saveCurrentObjectState( mesh );

			}

		} else {

			const camera = this.camera;
			const data = this._getPreviousFrameState( mesh );

			const material = type === MotionBlurPass.GEOMETRY ? data.geometryMaterial : data.velocityMaterial;
			const projMat = renderCameraBlur ? this._prevCamProjection : camera.projectionMatrix;
			const invMat = renderCameraBlur ? this._prevCamWorldInverse : camera.matrixWorldInverse;

			material.uniforms[ 'expandGeometry' ].value = expandGeometry;
			material.uniforms[ 'interpolateGeometry' ].value = interpolateGeometry;
			material.uniforms[ 'smearIntensity' ].value = smearIntensity;
			material.uniforms[ 'prevProjectionMatrix' ].value.copy( projMat );
			material.uniforms[ 'prevModelViewMatrix' ].value.multiplyMatrices( invMat, data.matrixWorld );

			renderer.renderBufferDirect( camera, null, mesh.geometry, material, mesh, null );

			if ( saveState ) {

				this._saveCurrentObjectState( mesh );

			}

		}

	}

	_ensurePrevCameraTransform() {

		const camera = this.camera;
		const projScreenMatrix = this._projScreenMatrix;

		// reinitialize the camera matrices to the current transform because if
		// the pass has been disabled then the matrices will be out of date
		if ( this._cameraMatricesNeedInitializing ) {

			this._prevCamWorldInverse.copy( camera.matrixWorldInverse );
			this._prevCamProjection.copy( camera.projectionMatrix );
			this._cameraMatricesNeedInitializing = false;

		}


		projScreenMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		this._frustum.setFromProjectionMatrix( projScreenMatrix );

	}

}

MotionBlurPass.DEFAULT = 0;
MotionBlurPass.VELOCITY = 1;
MotionBlurPass.GEOMETRY = 2;

MotionBlurPass.REGULAR_JITTER = 0;
MotionBlurPass.RANDOM_JITTER = 1;
MotionBlurPass.BLUENOISE_JITTER = 2;
