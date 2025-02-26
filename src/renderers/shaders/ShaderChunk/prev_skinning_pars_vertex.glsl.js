export default /* glsl */`
#ifdef USE_SKINNING
#ifdef BONE_TEXTURE
	uniform sampler2D prevBoneTexture;
	mat4 getPrevBoneMatrix( const in float i ) {
		float j = i * 4.0;
		float x = mod( j, float( boneTextureSize ) );
		float y = floor( j / float( boneTextureSize ) );
		float dx = 1.0 / float( boneTextureSize );
		float dy = 1.0 / float( boneTextureSize );
		y = dy * ( y + 0.5 );
		vec4 v1 = texture2D( prevBoneTexture, vec2( dx * ( x + 0.5 ), y ) );
		vec4 v2 = texture2D( prevBoneTexture, vec2( dx * ( x + 1.5 ), y ) );
		vec4 v3 = texture2D( prevBoneTexture, vec2( dx * ( x + 2.5 ), y ) );
		vec4 v4 = texture2D( prevBoneTexture, vec2( dx * ( x + 3.5 ), y ) );
		mat4 bone = mat4( v1, v2, v3, v4 );
		return bone;
	}
#else
	uniform mat4 prevBoneMatrices[ MAX_BONES ];
	mat4 getPrevBoneMatrix( const in float i ) {
		mat4 bone = prevBoneMatrices[ int(i) ];
		return bone;
	}
#endif
#endif
`;
