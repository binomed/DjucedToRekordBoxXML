// DJUCED -> Rekordbox XML converter.
//
// Reads DJUCED.db (SQLite) directly - no intermediate JSON exports needed.
// Key/cue binary encodings are documented officially by DJUCED:
// https://github.com/DJUCED/DJUCED_DJ/blob/main/doc/meta-tags.md

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = path.join(__dirname, 'DJUCED.db');
const OUTPUT_FILE = path.join(__dirname, 'output_rekordbox.xml');
const REKORDBOX_VERSION = '7.2.14';
const COMPANY = 'AlphaTheta';

// Annexe A of DJUCED's meta-tags.md: keyIndex 0-11 = major (A..G#), 12-23 = minor (a..g#),
// chromatic starting at A. Translated to Rekordbox's own flat-notation convention
// (observed in a real rekordbox export: flats everywhere except F#/F#m).
const TONALITY_TABLE = [
    'A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab',
    'Am', 'Bbm', 'Bm', 'Cm', 'Dbm', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm',
];

// DJUCED's own hot-cue color palette isn't publicly documented. These are just
// 8 visually distinct colors assigned by pad slot (0-7) so hot cues are easy to
// tell apart once imported - not an attempt to replicate DJUCED's exact palette.
const HOTCUE_COLORS = [
    [255, 55, 110],
    [255, 140, 0],
    [125, 193, 61],
    [170, 114, 255],
    [48, 152, 255],
    [255, 214, 0],
    [255, 71, 206],
    [44, 214, 217],
];

const KIND_MAP = { mp3: 'MP3 File', wav: 'WAV File', m4a: 'M4A File', flac: 'FLAC File', aiff: 'AIFF File', aif: 'AIFF File' };
const SUPPORTED_EXTENSIONS = new Set(Object.keys(KIND_MAP));

function escapeXml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[<>&"']/g, (c) => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
    }[c]));
}

function encodeLocation(absolutePath) {
    const encoded = absolutePath.split('/').map(encodeURIComponent).join('/');
    return `file://localhost${encoded}`;
}

function keyToTonality(rawKey) {
    const idx = parseInt(rawKey, 10);
    return Number.isInteger(idx) && idx >= 0 && idx < TONALITY_TABLE.length ? TONALITY_TABLE[idx] : '';
}

function loadTracks(db) {
    return db.prepare(`
        SELECT id, album, artist, bitrate, comment, composer, title, bpm, tracknumber,
               absolutepath, filetype, key, genre, filesize, length, rating, year,
               playcount, first_seen, samplerate
        FROM tracks
    `).all();
}

function loadCuesByTrack(db) {
    const rows = db.prepare(`
        SELECT trackId, cuename, cuenumber, cuepos, loopLength, isSavedLoop
        FROM trackCues
        WHERE cuenumber < 1000
        ORDER BY trackId, cuenumber
    `).all();
    const byTrack = new Map();
    for (const row of rows) {
        if (!byTrack.has(row.trackId)) byTrack.set(row.trackId, []);
        byTrack.get(row.trackId).push(row);
    }
    return byTrack;
}

function loadFirstBeatByTrack(db) {
    const rows = db.prepare('SELECT trackId, beatpos FROM trackBeats').all();
    const byTrack = new Map();
    for (const row of rows) byTrack.set(row.trackId, row.beatpos || 0);
    return byTrack;
}

function loadPlaylists(db) {
    const rows = db.prepare(`
        SELECT name, data, order_in_list
        FROM playlists2
        WHERE type = 3
        ORDER BY name, order_in_list
    `).all();
    const byName = new Map();
    for (const row of rows) {
        if (!byName.has(row.name)) byName.set(row.name, []);
        byName.get(row.name).push(row.data);
    }
    return byName;
}

function buildPositionMarks(cues, bpm) {
    return cues.map((cue) => {
        const isMemoryCue = cue.cuenumber === 0;
        const num = isMemoryCue ? -1 : cue.cuenumber - 1;
        const start = cue.cuepos || 0;
        const hasLoop = cue.isSavedLoop === 1 || (cue.loopLength || 0) > 0;

        if (hasLoop && bpm > 0) {
            const end = start + ((cue.loopLength || 0) * 60) / bpm;
            return { type: 4, name: cue.cuename || '', start, end, num };
        }
        return { type: 0, name: cue.cuename || '', start, num };
    });
}

function renderPositionMark(mark) {
    const attrs = [
        `Name="${escapeXml(mark.name)}"`,
        `Type="${mark.type}"`,
        `Start="${mark.start.toFixed(3)}"`,
    ];
    if (mark.type === 4) attrs.push(`End="${mark.end.toFixed(3)}"`);
    attrs.push(`Num="${mark.num}"`);
    if (mark.num >= 0) {
        const [r, g, b] = HOTCUE_COLORS[mark.num % HOTCUE_COLORS.length];
        attrs.push(`Red="${r}"`, `Green="${g}"`, `Blue="${b}"`);
    }
    return `      <POSITION_MARK ${attrs.join(' ')}/>\n`;
}

function renderTrack(track, cues, firstBeat) {
    const kind = KIND_MAP[track.filetype] || `${(track.filetype || '').toUpperCase()} File`;
    const totalTime = Math.round(track.length || 0);
    const dateAdded = track.first_seen ? track.first_seen.split('T')[0] : '';
    let comment = track.comment || '';
    if (comment === '0') comment = '';
    const rating = Math.round((track.rating || 0) * 51);
    const bpm = track.bpm || 0;
    const trackNumber = parseInt(track.tracknumber, 10) || 0;

    let xml = `    <TRACK TrackID="${track.id}" Name="${escapeXml(track.title)}" Artist="${escapeXml(track.artist)}" `;
    xml += `Composer="${escapeXml(track.composer)}" Album="${escapeXml(track.album)}" Grouping="" `;
    xml += `Genre="${escapeXml(track.genre)}" Kind="${kind}" Size="${track.filesize || 0}" TotalTime="${totalTime}" `;
    xml += `DiscNumber="0" TrackNumber="${trackNumber}" Year="${track.year || 0}" AverageBpm="${bpm.toFixed(2)}" `;
    xml += `DateAdded="${dateAdded}" BitRate="${track.bitrate || 0}" SampleRate="${track.samplerate || 0}" `;
    xml += `Comments="${escapeXml(comment)}" PlayCount="${track.playcount || 0}" Rating="${rating}" `;
    xml += `Location="${encodeLocation(track.absolutepath)}" Remixer="" Tonality="${keyToTonality(track.key)}" Label="" Mix="">\n`;

    if (bpm > 0) {
        xml += `      <TEMPO Inizio="${firstBeat.toFixed(3)}" Bpm="${bpm.toFixed(2)}" Metro="4/4" Battito="1"/>\n`;
    }

    for (const mark of buildPositionMarks(cues, bpm)) {
        xml += renderPositionMark(mark);
    }

    xml += `    </TRACK>\n`;
    return xml;
}

function run() {
    if (!fs.existsSync(DB_FILE)) {
        console.error(`Fichier introuvable : ${DB_FILE}`);
        process.exit(1);
    }

    console.log('Ouverture de DJUCED.db...');
    const db = new DatabaseSync(DB_FILE, { readOnly: true });

    const allTracks = loadTracks(db);
    const cuesByTrack = loadCuesByTrack(db);
    const firstBeatByTrack = loadFirstBeatByTrack(db);
    const playlists = loadPlaylists(db);
    db.close();

    console.log(`${allTracks.length} morceaux, ${playlists.size} playlists trouvés dans la base.`);

    const skipped = { unsupported_format: [], file_not_found: [] };
    const pathToId = new Map();
    const trackXmlBlocks = [];

    for (const track of allTracks) {
        const ext = (track.filetype || '').toLowerCase();

        if (!SUPPORTED_EXTENSIONS.has(ext)) {
            skipped.unsupported_format.push(track.absolutepath);
            continue;
        }
        if (!fs.existsSync(track.absolutepath)) {
            skipped.file_not_found.push(track.absolutepath);
            continue;
        }

        pathToId.set(track.absolutepath, track.id);
        const cues = cuesByTrack.get(track.absolutepath) || [];
        const firstBeat = firstBeatByTrack.get(track.absolutepath) || 0;
        trackXmlBlocks.push(renderTrack(track, cues, firstBeat));
    }

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<DJ_PLAYLISTS Version="1.0.0">\n`;
    xml += `  <PRODUCT Name="rekordbox" Version="${REKORDBOX_VERSION}" Company="${COMPANY}"/>\n`;
    xml += `  <COLLECTION Entries="${trackXmlBlocks.length}">\n`;
    xml += trackXmlBlocks.join('');
    xml += `  </COLLECTION>\n`;

    const playlistNames = [...playlists.keys()];
    xml += `  <PLAYLISTS>\n`;
    xml += `    <NODE Type="0" Name="ROOT" Count="${playlistNames.length}">\n`;
    for (const name of playlistNames) {
        const trackIds = playlists.get(name)
            .map((absolutePath) => pathToId.get(absolutePath))
            .filter((id) => id !== undefined);

        if (trackIds.length === 0) {
            xml += `      <NODE Name="${escapeXml(name)}" Type="1" KeyType="0" Entries="0"/>\n`;
            continue;
        }
        xml += `      <NODE Name="${escapeXml(name)}" Type="1" KeyType="0" Entries="${trackIds.length}">\n`;
        for (const id of trackIds) xml += `        <TRACK Key="${id}"/>\n`;
        xml += `      </NODE>\n`;
    }
    xml += `    </NODE>\n`;
    xml += `  </PLAYLISTS>\n`;
    xml += `</DJ_PLAYLISTS>\n`;

    fs.writeFileSync(OUTPUT_FILE, xml, 'utf8');

    console.log(`\nSuccès ! ${trackXmlBlocks.length} / ${allTracks.length} morceaux exportés vers ${OUTPUT_FILE}`);

    if (skipped.file_not_found.length) {
        console.log(`\n⚠️ ${skipped.file_not_found.length} fichiers introuvables sur le disque (ignorés) :`);
        skipped.file_not_found.slice(0, 15).forEach((p) => console.log(`  - ${p}`));
        if (skipped.file_not_found.length > 15) console.log(`  ... et ${skipped.file_not_found.length - 15} autres.`);
    }
    if (skipped.unsupported_format.length) {
        console.log(`\n⚠️ ${skipped.unsupported_format.length} fichiers dans un format non supporté par Rekordbox (ignorés, ex: .ogg, .djs) :`);
        skipped.unsupported_format.slice(0, 15).forEach((p) => console.log(`  - ${p}`));
        if (skipped.unsupported_format.length > 15) console.log(`  ... et ${skipped.unsupported_format.length - 15} autres.`);
    }
}

run();
