tell application "Spotify"
	set playerState to (player state as text)
	set trk to current track
	set trackName to name of trk
	set trackArtist to artist of trk
	set trackAlbum to album of trk
	set trackArt to artwork url of trk
	set trackPos to player position
	set trackDur to duration of trk
	set trackId to id of trk
	set trackAlbumArtist to ""
	try
		set trackAlbumArtist to album artist of trk
	end try
	return playerState & tab & trackName & tab & trackArtist & tab & trackAlbum & tab & trackArt & tab & trackPos & tab & trackDur & tab & trackId & tab & trackAlbumArtist
end tell
