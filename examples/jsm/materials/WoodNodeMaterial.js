import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

// some helpers below are ported from Blender and converted to TSL

const mapRange = TSL.Fn( ( [ x, fromMin, fromMax, toMin, toMax, clmp ] ) => {

	const factor = x.sub( fromMin ).div( fromMax.sub( fromMin ) );
	const result = toMin.add( factor.mul( toMax.sub( toMin ) ) );

	return TSL.select( clmp, TSL.max( TSL.min( result, toMax ), toMin ), result );

} );

const voronoi3d = TSL.wgslFn( `
    fn voronoi3d(x: vec3<f32>, smoothness: f32, randomness: f32) -> f32
    {
        let p = floor(x);
        let f = fract(x);

        var res = 0.0;
        var totalWeight = 0.0;
        
        for (var k = -1; k <= 1; k++)
        {
            for (var j = -1; j <= 1; j++)
            {
                for (var i = -1; i <= 1; i++)
                {
                    let b = vec3<f32>(f32(i), f32(j), f32(k));
                    let hashOffset = hash3d(p + b) * randomness;
                    let r = b - f + hashOffset;
                    let d = length(r);
                    
                    let weight = exp(-d * d / max(smoothness * smoothness, 0.001));
                    res += d * weight;
                    totalWeight += weight;
                }
            }
        }
        
        if (totalWeight > 0.0)
        {
            res /= totalWeight;
        }
        
        return smoothstep(0.0, 1.0, res);
    }

    fn hash3d(p: vec3<f32>) -> vec3<f32>
    {
        var p3 = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.xxy + p3.yzz) * p3.zyx);
    }
` );

// const hash3d = TSL.Fn( ( [ p ] ) => {

// 	const p3 = p.mul( TSL.vec3( 0.1031, 0.1030, 0.0973 ) ).fract();
// 	const dotProduct = p3.dot( p3.yzx.add( 33.33 ) );
// 	p3.addAssign( dotProduct );

// 	return p3.xxy.add( p3.yzz ).mul( p3.zyx ).fract();

// } );

// const voronoi3d = TSL.Fn( ( [ x, smoothness, randomness ] ) => {
// 	let p = TSL.floor(x);
// 	let f = TSL.fract(x);

// 	var res = TSL.float(0.0);
// 	var totalWeight = TSL.float(0.0);

// 	TSL.Loop( 3, 3, 3, ( { k, j, i } ) => {
// 		let b = TSL.vec3(TSL.float(i).sub(1), TSL.float(j).sub(1), TSL.float(k).sub(1));
// 		let hashOffset = hash3d(p.add(b)).mul(randomness);
// 		let r = b.sub(f).add(hashOffset);
// 		let d = TSL.length(r);

// 		let weight = TSL.exp(d.negate().mul(d).div(TSL.max(smoothness.mul(smoothness), 0.001)));
// 		res.addAssign(d.mul(weight));
// 		totalWeight.addAssign(weight);
// 	} );

// 	res.assign(TSL.select(totalWeight.greaterThan(0.0), res.div(totalWeight), res));

// 	return TSL.smoothstep(0.0, 1.0, res);
// } );

const softLightMix = TSL.Fn( ( [ t, col1, col2 ] ) => {

	const tm = TSL.float( 1.0 ).sub( t );

	const one = TSL.vec3( 1.0 );
	const scr = one.sub( one.sub( col2 ).mul( one.sub( col1 ) ) );

	return tm.mul( col1 ).add( t.mul( one.sub( col1 ).mul( col2 ).mul( col1 ).add( col1.mul( scr ) ) ) );

} );

// single-octave normalized noise — equivalent to fbm with detail = 1

const noise1Norm = TSL.Fn( ( [ p ] ) => TSL.mx_noise_float( p ).mul( 0.5 ).add( 0.5 ) );
const noise3Norm = TSL.Fn( ( [ p ] ) => TSL.mx_noise_vec3( p ).mul( 0.5 ).add( 0.5 ) );

const woodCenter = TSL.Fn( ( [ p, centerSize ] ) => {

	const pxyCenter = p.mul( TSL.vec3( 1, 1, 0 ) ).length();
	const center = mapRange( pxyCenter, 0, 1, 0, centerSize, true );

	return center;

} );

const spaceWarp = TSL.Fn( ( [ p, warpStrength, xyScale, zScale ] ) => {

	const combinedXyz = TSL.vec3( xyScale, xyScale, zScale ).mul( p );
	const noise = noise3Norm( combinedXyz.mul( 1.6 * 1.5 ) ).sub( 0.5 ).mul( warpStrength );
	const pXy = p.mul( TSL.vec3( 1, 1, 0 ) );
	const normalizedXy = pXy.normalize();
	const warp = noise.mul( normalizedXy ).add( pXy );

	return warp;

} );

const woodRings = TSL.Fn( ( [ w, ringThickness, ringBias, ringSizeVariance, ringVarianceScale, barkThickness ] ) => {

	const rings = noise1Norm( w.mul( ringVarianceScale ) ).mul( ringSizeVariance ).add( w ).mul( ringThickness ).fract().mul( barkThickness );

	const sharpRings = TSL.min( mapRange( rings, 0, ringBias, 0, 1, TSL.bool( true ) ), mapRange( rings, ringBias, 1, 1, 0, TSL.bool( true ) ) );

	const blurAmount = TSL.max( TSL.positionView.length().div( 10 ), 1 );
	const blurredRings = TSL.smoothstep( blurAmount.negate(), blurAmount, sharpRings.sub( 0.5 ) ).mul( 0.5 ).add( 0.5 );

	return blurredRings;

} );

const woodDetail = TSL.Fn( ( [ warp, p, y, splotchScale ] ) => {

	const radialCoords = TSL.clamp( TSL.atan( warp.y, warp.x ).div( TSL.PI2 ).add( 0.5 ), 0, 1 ).mul( TSL.PI2.mul( 3 ) );
	const combinedXyz = TSL.vec3( radialCoords.sin(), y, radialCoords.cos().mul( p.z ) );
	const scaled = TSL.vec3( 0.1, 1.19, 0.05 ).mul( combinedXyz );

	return noise1Norm( scaled.mul( splotchScale ) );

} );

const cellStructure = TSL.Fn( ( [ p, cellScale, cellSize ] ) => {

	const warp = spaceWarp( p.mul( cellScale.div( 50 ) ), cellScale.div( 1000 ), 0.1, 1.77 );
	const cells = voronoi3d( warp.xy.mul( 75 ), 0.5, 1 );

	return mapRange( cells, cellSize, cellSize.add( 0.21 ), 0, 1, TSL.bool( true ) );

} );

const wood = TSL.Fn( ( [
	p,
	centerSize,
	largeWarpScale,
	largeGrainStretch,
	smallWarpStrength,
	smallWarpScale,
	fineWarpStrength,
	fineWarpScale,
	ringThickness,
	ringBias,
	ringSizeVariance,
	ringVarianceScale,
	barkThickness,
	splotchScale,
	splotchIntensity,
	cellScale,
	cellSize,
	darkGrainColor,
	lightGrainColor
] ) => {

	const center = woodCenter( p, centerSize );
	const mainWarp = spaceWarp( spaceWarp( p, center, largeWarpScale, largeGrainStretch ), smallWarpStrength, smallWarpScale, 0.17 );
	const detailWarp = spaceWarp( mainWarp, fineWarpStrength, fineWarpScale, 0.17 );
	const rings = woodRings( detailWarp.length(), TSL.float( 1 ).div( ringThickness ), ringBias, ringSizeVariance, ringVarianceScale, barkThickness );
	const detail = woodDetail( detailWarp, p, detailWarp.length(), splotchScale );
	const cells = cellStructure( mainWarp, cellScale, cellSize.div( TSL.max( TSL.positionView.length().mul( 10 ), 1 ) ) );
	const baseColor = TSL.mix( darkGrainColor, lightGrainColor, rings );

	return softLightMix( splotchIntensity, softLightMix( 0.407, baseColor, cells ), detail );

} );

const woodParams = {
	teak: {
		transformationMatrix: new THREE.Matrix4().identity(),
		centerSize: 1.11, largeWarpScale: 0.32, largeGrainStretch: 0.24, smallWarpStrength: 0.059,
		smallWarpScale: 2, fineWarpStrength: 0.006, fineWarpScale: 32.8, ringThickness: 1 / 34,
		ringBias: 0.03, ringSizeVariance: 0.03, ringVarianceScale: 4.4, barkThickness: 0.3,
		splotchScale: 0.2, splotchIntensity: 0.541, cellScale: 910, cellSize: 0.1,
		darkGrainColor: '#0c0504', lightGrainColor: '#926c50'
	},
	walnut: {
		transformationMatrix: new THREE.Matrix4().identity(),
		centerSize: 1.07, largeWarpScale: 0.42, largeGrainStretch: 0.34, smallWarpStrength: 0.016,
		smallWarpScale: 10.3, fineWarpStrength: 0.028, fineWarpScale: 12.7, ringThickness: 1 / 32,
		ringBias: 0.08, ringSizeVariance: 0.03, ringVarianceScale: 5.5, barkThickness: 0.98,
		splotchScale: 1.84, splotchIntensity: 0.97, cellScale: 710, cellSize: 0.31,
		darkGrainColor: '#311e13', lightGrainColor: '#523424'
	},
	white_oak: {
		transformationMatrix: new THREE.Matrix4().identity(),
		centerSize: 1.23, largeWarpScale: 0.21, largeGrainStretch: 0.21, smallWarpStrength: 0.034,
		smallWarpScale: 2.44, fineWarpStrength: 0.01, fineWarpScale: 14.3, ringThickness: 1 / 34,
		ringBias: 0.82, ringSizeVariance: 0.16, ringVarianceScale: 1.4, barkThickness: 0.7,
		splotchScale: 0.2, splotchIntensity: 0.541, cellScale: 800, cellSize: 0.28,
		darkGrainColor: '#8b4c21', lightGrainColor: '#c57e43'
	},
	pine: {
		transformationMatrix: new THREE.Matrix4().identity(),
		centerSize: 1.23, largeWarpScale: 0.21, largeGrainStretch: 0.18, smallWarpStrength: 0.041,
		smallWarpScale: 2.44, fineWarpStrength: 0.006, fineWarpScale: 23.2, ringThickness: 1 / 24,
		ringBias: 0.1, ringSizeVariance: 0.07, ringVarianceScale: 5, barkThickness: 0.35,
		splotchScale: 0.51, splotchIntensity: 3.32, cellScale: 1480, cellSize: 0.07,
		darkGrainColor: '#c58355', lightGrainColor: '#d19d61'
	},
	poplar: {
		transformationMatrix: new THREE.Matrix4().identity(),
		centerSize: 1.43, largeWarpScale: 0.33, largeGrainStretch: 0.18, smallWarpStrength: 0.04,
		smallWarpScale: 4.3, fineWarpStrength: 0.004, fineWarpScale: 33.6, ringThickness: 1 / 37,
		ringBias: 0.07, ringSizeVariance: 0.03, ringVarianceScale: 3.8, barkThickness: 0.3,
		splotchScale: 1.92, splotchIntensity: 0.71, cellScale: 830, cellSize: 0.04,
		darkGrainColor: '#716347', lightGrainColor: '#998966'
	},
	maple: {
		transformationMatrix: new THREE.Matrix4().identity(),
		centerSize: 1.4, largeWarpScale: 0.38, largeGrainStretch: 0.25, smallWarpStrength: 0.067,
		smallWarpScale: 2.5, fineWarpStrength: 0.005, fineWarpScale: 33.6, ringThickness: 1 / 35,
		ringBias: 0.1, ringSizeVariance: 0.07, ringVarianceScale: 4.6, barkThickness: 0.61,
		splotchScale: 0.46, splotchIntensity: 1.49, cellScale: 800, cellSize: 0.03,
		darkGrainColor: '#b08969', lightGrainColor: '#bc9d7d'
	},
	red_oak: {
		transformationMatrix: new THREE.Matrix4().identity(),
		centerSize: 1.21, largeWarpScale: 0.24, largeGrainStretch: 0.25, smallWarpStrength: 0.044,
		smallWarpScale: 2.54, fineWarpStrength: 0.01, fineWarpScale: 14.5, ringThickness: 1 / 34,
		ringBias: 0.92, ringSizeVariance: 0.03, ringVarianceScale: 5.6, barkThickness: 1.01,
		splotchScale: 0.28, splotchIntensity: 3.48, cellScale: 800, cellSize: 0.25,
		darkGrainColor: '#af613b', lightGrainColor: '#e0a27a'
	},
	cherry: {
		transformationMatrix: new THREE.Matrix4().identity(),
		centerSize: 1.33, largeWarpScale: 0.11, largeGrainStretch: 0.33, smallWarpStrength: 0.024,
		smallWarpScale: 2.48, fineWarpStrength: 0.01, fineWarpScale: 15.3, ringThickness: 1 / 36,
		ringBias: 0.02, ringSizeVariance: 0.04, ringVarianceScale: 6.5, barkThickness: 0.09,
		splotchScale: 1.27, splotchIntensity: 1.24, cellScale: 1530, cellSize: 0.15,
		darkGrainColor: '#913f27', lightGrainColor: '#b45837'
	},
	cedar: {
		transformationMatrix: new THREE.Matrix4().identity(),
		centerSize: 1.11, largeWarpScale: 0.39, largeGrainStretch: 0.12, smallWarpStrength: 0.061,
		smallWarpScale: 1.9, fineWarpStrength: 0.006, fineWarpScale: 4.8, ringThickness: 1 / 25,
		ringBias: 0.01, ringSizeVariance: 0.07, ringVarianceScale: 6.7, barkThickness: 0.1,
		splotchScale: 0.61, splotchIntensity: 2.54, cellScale: 630, cellSize: 0.19,
		darkGrainColor: '#9a5b49', lightGrainColor: '#ae745e'
	},
	mahogany: {
		transformationMatrix: new THREE.Matrix4().identity(),
		centerSize: 1.25, largeWarpScale: 0.26, largeGrainStretch: 0.29, smallWarpStrength: 0.044,
		smallWarpScale: 2.54, fineWarpStrength: 0.01, fineWarpScale: 15.3, ringThickness: 1 / 38,
		ringBias: 0.01, ringSizeVariance: 0.33, ringVarianceScale: 1.2, barkThickness: 0.07,
		splotchScale: 0.77, splotchIntensity: 1.39, cellScale: 1400, cellSize: 0.23,
		darkGrainColor: '#501d12', lightGrainColor: '#6d3722'
	}
};

export const WoodGenuses = [ 'teak', 'walnut', 'white_oak', 'pine', 'poplar', 'maple', 'red_oak', 'cherry', 'cedar', 'mahogany' ];
export const Finishes = [ 'raw', 'matte', 'semigloss', 'gloss' ];

export function GetWoodPreset( genus, finish ) {

	const params = woodParams[ genus ];

	let clearcoat, clearcoatRoughness, clearcoatDarken;

	switch ( finish ) {

		case 'gloss':
			clearcoatDarken = 0.2; clearcoatRoughness = 0.1; clearcoat = 1;
			break;

		case 'semigloss':
			clearcoatDarken = 0.4; clearcoatRoughness = 0.4; clearcoat = 1;
			break;

		case 'matte':
			clearcoatDarken = 0.6; clearcoatRoughness = 1; clearcoat = 1;
			break;

		case 'raw':
		default:
			clearcoatDarken = 1; clearcoatRoughness = 0; clearcoat = 0;

	}

	return { ...params, transformationMatrix: new THREE.Matrix4().copy( params.transformationMatrix ), genus, finish, clearcoat, clearcoatRoughness, clearcoatDarken };

}

const params = GetWoodPreset( WoodGenuses[ 0 ], Finishes[ 0 ] );

// the values are read from each WoodNodeMaterial instance, so all instances share one shader

const uniforms = {};

uniforms.centerSize = TSL.materialReference( 'centerSize', 'float' );
uniforms.largeWarpScale = TSL.materialReference( 'largeWarpScale', 'float' );
uniforms.largeGrainStretch = TSL.materialReference( 'largeGrainStretch', 'float' );
uniforms.smallWarpStrength = TSL.materialReference( 'smallWarpStrength', 'float' );
uniforms.smallWarpScale = TSL.materialReference( 'smallWarpScale', 'float' );
uniforms.fineWarpStrength = TSL.materialReference( 'fineWarpStrength', 'float' );
uniforms.fineWarpScale = TSL.materialReference( 'fineWarpScale', 'float' );
uniforms.ringThickness = TSL.materialReference( 'ringThickness', 'float' );
uniforms.ringBias = TSL.materialReference( 'ringBias', 'float' );
uniforms.ringSizeVariance = TSL.materialReference( 'ringSizeVariance', 'float' );
uniforms.ringVarianceScale = TSL.materialReference( 'ringVarianceScale', 'float' );
uniforms.barkThickness = TSL.materialReference( 'barkThickness', 'float' );
uniforms.splotchScale = TSL.materialReference( 'splotchScale', 'float' );
uniforms.splotchIntensity = TSL.materialReference( 'splotchIntensity', 'float' );
uniforms.cellScale = TSL.materialReference( 'cellScale', 'float' );
uniforms.cellSize = TSL.materialReference( 'cellSize', 'float' );
uniforms.darkGrainColor = TSL.materialReference( 'darkGrainColor', 'color' );
uniforms.lightGrainColor = TSL.materialReference( 'lightGrainColor', 'color' );
uniforms.transformationMatrix = TSL.materialReference( 'transformationMatrix', 'mat4' );
uniforms.clearcoat = TSL.materialReference( 'clearcoat', 'float' );

// the node material defining the shared shader

const woodMaterial = new THREE.MeshPhysicalNodeMaterial();

woodMaterial.colorNode = wood(
	uniforms.transformationMatrix.mul( TSL.vec4( TSL.positionLocal, 1 ) ).xyz,
	uniforms.centerSize,
	uniforms.largeWarpScale,
	uniforms.largeGrainStretch,
	uniforms.smallWarpStrength,
	uniforms.smallWarpScale,
	uniforms.fineWarpStrength,
	uniforms.fineWarpScale,
	uniforms.ringThickness,
	uniforms.ringBias,
	uniforms.ringSizeVariance,
	uniforms.ringVarianceScale,
	uniforms.barkThickness,
	uniforms.splotchScale,
	uniforms.splotchIntensity,
	uniforms.cellScale,
	uniforms.cellSize,
	uniforms.darkGrainColor,
	uniforms.lightGrainColor
).mul( params.clearcoatDarken );

// a clearcoat node keeps the clear coat layer in the shared shader, even for instances without a finish

woodMaterial.clearcoatNode = uniforms.clearcoat;

/**
 * Procedural wood material using TSL (Three.js Shading Language).
 *
 * Usage examples:
 *
 * // Using presets (recommended for common wood types)
 * const material = WoodNodeMaterial.fromPreset('walnut', 'gloss');
 *
 * // Using custom parameters (for advanced customization)
 * const material = new WoodNodeMaterial({
 *   centerSize: 1.2,
 *   ringThickness: 1/40,
 *   darkGrainColor: new THREE.Color('#2a1a0a'),
 *   lightGrainColor: new THREE.Color('#8b4513'),
 *   clearcoat: 1,
 *   clearcoatRoughness: 0.3
 * });
 *
 * // Mixing presets with custom overrides
 * const walnutParams = GetWoodPreset('walnut', 'raw');
 * const material = new WoodNodeMaterial({
 *   ...walnutParams,
 *   ringThickness: 1/50,  // Override specific parameter
 *   clearcoat: 1    // Add finish
 * });
 *
 * @augments ProxyNodeMaterial
 */
export class WoodNodeMaterial extends THREE.ProxyNodeMaterial {

	/**
	 * Constructs a new wood material. Values that are not provided fall back to the `teak` / `raw` preset.
	 *
	 * @param {Object} [params] - An object with one or more properties defining the material's appearance.
	 */
	constructor( params = {} ) {

		super( woodMaterial );

		this.type = 'WoodNodeMaterial';

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isWoodNodeMaterial = true;

		const preset = GetWoodPreset( 'teak', 'raw' );

		/**
		 * Transforms the local position before the wood pattern is evaluated.
		 *
		 * @type {Matrix4}
		 * @default (identity matrix)
		 */
		this.transformationMatrix = preset.transformationMatrix;

		/**
		 * How strongly the grain warps away from the center of the log.
		 *
		 * @type {number}
		 * @default 1.11
		 */
		this.centerSize = preset.centerSize;

		/**
		 * Frequency of the large-scale grain warp across the rings.
		 *
		 * @type {number}
		 * @default 0.32
		 */
		this.largeWarpScale = preset.largeWarpScale;

		/**
		 * Frequency of the large-scale grain warp along the length of the log.
		 *
		 * @type {number}
		 * @default 0.24
		 */
		this.largeGrainStretch = preset.largeGrainStretch;

		/**
		 * Strength of the medium-scale grain warp.
		 *
		 * @type {number}
		 * @default 0.059
		 */
		this.smallWarpStrength = preset.smallWarpStrength;

		/**
		 * Frequency of the medium-scale grain warp.
		 *
		 * @type {number}
		 * @default 2
		 */
		this.smallWarpScale = preset.smallWarpScale;

		/**
		 * Strength of the fine-scale grain warp.
		 *
		 * @type {number}
		 * @default 0.006
		 */
		this.fineWarpStrength = preset.fineWarpStrength;

		/**
		 * Frequency of the fine-scale grain warp.
		 *
		 * @type {number}
		 * @default 32.8
		 */
		this.fineWarpScale = preset.fineWarpScale;

		/**
		 * Thickness of the growth rings.
		 *
		 * @type {number}
		 * @default 1/34
		 */
		this.ringThickness = preset.ringThickness;

		/**
		 * Position of the peak within each ring's profile, in the range `[0, 1]`.
		 *
		 * @type {number}
		 * @default 0.03
		 */
		this.ringBias = preset.ringBias;

		/**
		 * Amount of noise-driven variation in ring spacing.
		 *
		 * @type {number}
		 * @default 0.03
		 */
		this.ringSizeVariance = preset.ringSizeVariance;

		/**
		 * Frequency of the ring spacing variation.
		 *
		 * @type {number}
		 * @default 4.4
		 */
		this.ringVarianceScale = preset.ringVarianceScale;

		/**
		 * Scales the ring profile before it is shaped by `ringBias`.
		 *
		 * @type {number}
		 * @default 0.3
		 */
		this.barkThickness = preset.barkThickness;

		/**
		 * Frequency of the color splotches.
		 *
		 * @type {number}
		 * @default 0.2
		 */
		this.splotchScale = preset.splotchScale;

		/**
		 * Blend strength of the color splotches.
		 *
		 * @type {number}
		 * @default 0.541
		 */
		this.splotchIntensity = preset.splotchIntensity;

		/**
		 * Frequency of the pore cell pattern.
		 *
		 * @type {number}
		 * @default 910
		 */
		this.cellScale = preset.cellScale;

		/**
		 * Size of the pore cells.
		 *
		 * @type {number}
		 * @default 0.1
		 */
		this.cellSize = preset.cellSize;

		/**
		 * Color of the dark grain.
		 *
		 * @type {Color}
		 * @default (0x0c0504)
		 */
		this.darkGrainColor = new THREE.Color( preset.darkGrainColor );

		/**
		 * Color of the light grain.
		 *
		 * @type {Color}
		 * @default (0x926c50)
		 */
		this.lightGrainColor = new THREE.Color( preset.lightGrainColor );

		/**
		 * Intensity of the clear coat layer.
		 *
		 * @type {number}
		 * @default 0
		 */
		this.clearcoat = preset.clearcoat;

		/**
		 * Roughness of the clear coat layer.
		 *
		 * @type {number}
		 * @default 0
		 */
		this.clearcoatRoughness = preset.clearcoatRoughness;

		/**
		 * How much a finish darkens the wood beneath the clear coat. Stored with the
		 * finish presets, but not applied by the shader.
		 *
		 * @type {number}
		 * @default 1
		 */
		this.clearcoatDarken = preset.clearcoatDarken;

		// presets also contain their genus and finish, which are not material properties

		const values = { ...params };

		delete values.genus;
		delete values.finish;

		this.setValues( values );

	}

	/**
	 * Returns a new wood material with the same values.
	 *
	 * @return {WoodNodeMaterial} A clone of this instance.
	 */
	clone() {

		return new this.constructor().copy( this );

	}

	/**
	 * Creates a wood material from a preset.
	 *
	 * @param {string} [genus='teak'] - The wood genus, one of {@link WoodGenuses}.
	 * @param {string} [finish='raw'] - The finish, one of {@link Finishes}.
	 * @return {WoodNodeMaterial} The new wood material.
	 */
	static fromPreset( genus = 'teak', finish = 'raw' ) {

		return new WoodNodeMaterial( GetWoodPreset( genus, finish ) );

	}

}
