import fetch from 'node-fetch';

// Helper: safely read nested properties
const getFirstDefined = (obj, keys) => {
  for (const k of keys) {
    const parts = k.split('.');
    let cur = obj;
    let ok = true;
    for (const p of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
      else { ok = false; break; }
    }
    if (ok && cur) return cur;
  }
  return null;
};

export default async function handler(req, res) {
  const { url, format } = req.query;
  if (!url) return res.status(400).json({ error: "Parameter 'url' wajib diisi." });

  // Normalize requested format
  const fmt = (format || 'mp4').toLowerCase();

  try {
    // Primary lookup using TikMate (public lookup API). This may change over time.
    const lookup = `https://api.tikmate.app/api/lookup?url=${encodeURIComponent(url)}`;
    const r = await fetch(lookup, { timeout: 20000 });
    if (!r.ok) {
      // If lookup failed, return useful error
      return res.status(502).json({ error: `Lookup API error ${r.status}` });
    }
    const data = await r.json();

    // Attempt to find candidate URLs from common fields returned by various lookup endpoints
    const directCandidates = [
      'video_url',
      'videoUrl',
      'downloadUrl',
      'download_url',
      'video',
      'data.playUrl',
      'itemInfo.itemStruct.video.playAddr',
      'item.video.playAddr',
      'cover_url',
      'result.video',
      'result.video_url'
    ];

    // Find thumbnail
    const thumbnail = getFirstDefined(data, [
      'cover_url',
      'thumbnail',
      'thumbnail_url',
      'data.cover_url',
      'itemInfo.itemStruct.video.cover',
      'item.video.cover'
    ]) || '';

    // Heuristic: tikmate returns an object 'download' or 'data' with multiple variants in some cases
    // try to find HD variant first
    let videoUrl = null;
    // common shapes
    if (data && typeof data === 'object') {
      // If 'download' object with qualities
      if (data.download && Array.isArray(data.download)) {
        // array of {quality, url} ?
        for (const item of data.download) {
          if (item.quality && /hd|720|1080/i.test(item.quality)) { videoUrl = item.url; break; }
        }
        if (!videoUrl && data.download.length) videoUrl = data.download[0].url || data.download[0];
      }
      // if 'video' field
      if (!videoUrl) {
        videoUrl = getFirstDefined(data, ['video_url','videoUrl','video','data.video','result.video']);
      }
      // if nested playAddr
      if (!videoUrl) {
        videoUrl = getFirstDefined(data, [
          'itemInfo.itemStruct.video.playAddr',
          'item.video.playAddr',
          'data.playAddr',
          'result.playAddr'
        ]);
      }
      // some APIs return an object with 'hd' and 'sd'
      if (!videoUrl && data.files && typeof data.files === 'object') {
        videoUrl = data.files.hd || data.files.sd || data.files[0];
      }
    }

    // fallback: scan object values for the first https link that looks like media
    if (!videoUrl) {
      const jsonStr = JSON.stringify(data);
      const m = jsonStr.match(/https?:\\/\\/[^"']+?(?:\.mp4|\.m3u8|video|cdn[^"']+?)/i);
      if (m) videoUrl = m[0].replace(/\\/g, '');
    }

    // As last resort, try simple property list
    if (!videoUrl) {
      videoUrl = getFirstDefined(data, directCandidates) || null;
    }

    // At this point videoUrl is best-effort. If still missing, return entire lookup payload for debugging.
    if (!videoUrl) {
      return res.status(500).json({
        error: "Gagal menemukan URL video dari layanan lookup. Payload lookup dikembalikan untuk debugging.",
        lookup: data
      });
    }

    // If user requested mp3, attempt conversion via optional external converter service.
    // You can configure a converter by setting CONVERTER_API env var to a POST endpoint that accepts JSON { url } and returns { downloadUrl }
    if (fmt === 'mp3') {
      const converterApi = process.env.CONVERTER_API || null;
      if (converterApi) {
        try {
          const convResp = await fetch(converterApi, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: videoUrl }),
            timeout: 120000
          });
          if (!convResp.ok) throw new Error('Converter service returned ' + convResp.status);
          const convJson = await convResp.json();
          if (convJson && convJson.downloadUrl) {
            return res.status(200).json({
              title: data.title || convJson.title || 'TikTok Audio',
              thumbnail,
              size: convJson.size || 'unknown',
              downloadUrl: convJson.downloadUrl,
              note: 'Converted via external converter'
            });
          } else {
            throw new Error('Converter tidak mengembalikan downloadUrl.');
          }
        } catch (e) {
          // converter failed; return fallback: direct video URL + instruction
          return res.status(200).json({
            title: data.title || 'TikTok Media',
            thumbnail,
            size: 'unknown',
            downloadUrl: videoUrl,
            note: 'Konversi ke MP3 gagal: ' + e.message + '. Jika ingin MP3 otomatis, set CONVERTER_API pada environment ke layanan konversi (atau jalankan server dengan ffmpeg).'
          });
        }
      } else {
        // no converter configured: return video URL and instruct user how to enable mp3 conversion
        return res.status(200).json({
          title: data.title || 'TikTok Media',
          thumbnail,
          size: 'unknown',
          downloadUrl: videoUrl,
          note: 'Belum ada converter MP3 terpasang. Untuk MP3 otomatis, set environment variable CONVERTER_API ke URL layanan konversi OR deploy on server with ffmpeg and enable conversion.'
        });
      }
    }

    // For MP4/MP4HD: if user requested mp4hd try to prefer hd-like urls
    if (fmt === 'mp4hd' || fmt === 'mp4') {
      // If the lookup returned multiple qualities, try to pick HD
      // Some services include 'hd' in the path; prefer URLs containing '1080' or '720' or 'hd'
      if (fmt === 'mp4hd') {
        if (!/1080|720|hd/i.test(videoUrl)) {
          // try to find alternate inside payload
          const jsonStr = JSON.stringify(data);
          const candidates = Array.from(jsonStr.matchAll(/https?:\\/\\/[^"']+?(?:\.mp4|m3u8|cdn[^"']+?)/ig)).map(m=>m[0].replace(/\\/g,''));
          const better = candidates.find(u => /1080|720|hd/i.test(u));
          if (better) videoUrl = better;
        }
      }

      return res.status(200).json({
        title: data.title || 'TikTok Video',
        thumbnail,
        size: 'auto',
        downloadUrl: videoUrl,
        note: 'Direct media URL (proxying not performed). If your browser blocks CORS, consider proxying the media through your server.'
      });
    }

    // default fallback
    return res.status(200).json({
      title: data.title || 'TikTok Media',
      thumbnail,
      size: 'auto',
      downloadUrl: videoUrl
    });

  } catch (err) {
    console.error('Error in /api/download:', err);
    return res.status(500).json({ error: err.message });
  }
}
