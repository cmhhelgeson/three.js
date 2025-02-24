import { ShaderChunk } from 'three';

export default /* glsl */`
		vec3 transformed;

		// Get the normal
		${ ShaderChunk.skinbase_vertex }
		${ ShaderChunk.beginnormal_vertex }
		${ ShaderChunk.skinnormal_vertex }
		${ ShaderChunk.defaultnormal_vertex }

		// Get the current vertex position
		transformed = vec3( position );
		${ ShaderChunk.skinning_vertex }
		newPosition = modelViewMatrix * vec4(transformed, 1.0);

		// Get the previous vertex position
		transformed = vec3( position );
		${ ShaderChunk.skinbase_vertex.replace( /mat4 /g, '' ).replace( /getBoneMatrix/g, 'getPrevBoneMatrix' ) }
		${ ShaderChunk.skinning_vertex.replace( /vec4 /g, '' ) }
		prevPosition = prevModelViewMatrix * vec4(transformed, 1.0);

		// The delta between frames
		vec3 delta = newPosition.xyz - prevPosition.xyz;
		vec3 direction = normalize(delta);

		// Stretch along the velocity axes
		// TODO: Can we combine the stretch and expand
		float stretchDot = dot(direction, transformedNormal);
		vec4 expandDir = vec4(direction, 0.0) * stretchDot * expandGeometry * length(delta);
		vec4 newPosition2 =  projectionMatrix * (newPosition + expandDir);
		vec4 prevPosition2 = prevProjectionMatrix * (prevPosition + expandDir);

		newPosition =  projectionMatrix * newPosition;
		prevPosition = prevProjectionMatrix * prevPosition;

		gl_Position = mix(newPosition2, prevPosition2, interpolateGeometry * (1.0 - step(0.0, stretchDot) ) );
	`;
