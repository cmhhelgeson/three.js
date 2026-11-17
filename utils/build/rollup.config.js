import MagicString from 'magic-string';

function glsl() {

	return {

		transform( code, id ) {

			if ( /\.glsl.js$/.test( id ) === false ) return;

			code = new MagicString( code );

			code.replace( /\/\* glsl \*\/\`(.*?)\`/sg, function ( match, p1 ) {

				return JSON.stringify(
					p1
						.trim()
						.replace( /\r/g, '' )
						.replace( /[ \t]*\/\/.*\n/g, '' ) // remove //
						.replace( /[ \t]*\/\*[\s\S]*?\*\//g, '' ) // remove /* */
						.replace( /\n{2,}/g, '\n' ) // # \n+ to \n
				);

			} );

			return {
				code: code.toString(),
				map: code.generateMap()
			};

		}

	};

}

function header() {

	return {

		renderChunk( code ) {

			code = new MagicString( code );

			code.prepend( `/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */\n` );

			return {
				code: code.toString(),
				map: code.generateMap()
			};

		}

	};

}

// WebGPURenderer imports its WebGL 2 backend on demand. This emits the backend as its own
// file, with a fixed name and all its exports, which is loaded after the given WebGPU build

function webglBackend( fileName, webgpuInput ) {

	return {

		buildStart() {

			this.emitFile( {
				type: 'chunk',
				id: 'src/Three.WebGPU.WebGL.js',
				fileName,
				preserveSignature: 'strict',
				implicitlyLoadedAfterOneOf: [ webgpuInput ]
			} );

		}

	};

}

/**
 * @type {Array<import('rollup').RollupOptions>}
 */
const builds = [
	{
		input: {
			'three.core.js': 'src/Three.Core.js',
			'three.webgpu.nodes.js': 'src/Three.WebGPU.Nodes.js',
		},
		plugins: [
			glsl(),
			webglBackend( 'three.webgpu.nodes.webgl.js', 'src/Three.WebGPU.Nodes.js' ),
			header()
		],
		preserveEntrySignatures: 'allow-extension',
		output: [
			{
				format: 'esm',
				dir: 'build',
				minifyInternalExports: false,
				entryFileNames: '[name]',
			}
		]
	},
	{
		input: {
			'three.core.js': 'src/Three.Core.js',
			'three.module.js': 'src/Three.js',
			'three.webgpu.js': 'src/Three.WebGPU.js',
			'three.tsl.js': 'src/Three.TSL.js',
		},
		plugins: [
			glsl(),
			webglBackend( 'three.webgpu.webgl.js', 'src/Three.WebGPU.js' ),
			header()
		],
		preserveEntrySignatures: 'allow-extension',
		output: [
			{
				format: 'esm',
				dir: 'build',
				minifyInternalExports: false,
				entryFileNames: '[name]',
			}
		]
	}
];

export default builds;
