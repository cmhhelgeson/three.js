import { Matrix4, ShaderChunk } from 'three';

export const GeometryShader = {
	name: 'MotionBlurGeometryShader',
	uniforms: {
		prevProjectionMatrix: { value: new Matrix4() },
		prevModelViewMatrix: { value: new Matrix4() },
		prevBoneTexture: { value: null },
		expandGeometry: { value: 0 }, interpolateGeometry: { value: 1 },
		smearIntensity: { value: 1 }

	},

	vertexShader:
		`
			${ ShaderChunk.skinning_pars_vertex } 
			${ ShaderChunk.prev_skinning_pars_vertex }

			uniform mat4 prevProjectionMatrix;
			uniform mat4 prevModelViewMatrix;
			uniform float expandGeometry;
			uniform float interpolateGeometry;
			varying vec4 prevPosition;
			varying vec4 newPosition;
			varying vec3 color;

			void main() {

				${ ShaderChunk.velocity_vertex }

				color = (modelViewMatrix * vec4(normal.xyz, 0)).xyz;
				color = normalize(color);

			}
		`,

	fragmentShader:
		`
			varying vec3 color;

			void main() {
				gl_FragColor = vec4(color, 1);
			}
		`
};
