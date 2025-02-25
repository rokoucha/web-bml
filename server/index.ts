import Koa from 'koa';
import Router from 'koa-router';
import fs, { mkdirSync } from "fs"
import 'dotenv/config'
import path from "path";
import stream from "stream";
import { TsStream } from "@chinachu/aribts";
import websocket, { WebSocketContext } from "koa-easy-ws";
import * as wsApi from "./ws_api";
import { WebSocket } from "ws";
import http from "http";
import { randomUUID } from 'crypto';
import { DataBroadcastingStream, LiveStream } from './stream/live_stream';
import { HLSLiveStream } from './stream/hls_stream';
import { decodeTS } from './decode_ts';
import { downloadFonts } from './font';
downloadFonts();

let port = Number.parseInt(process.env.PORT ?? "");
if (Number.isNaN(port)) {
    port = 23234;
}
const host = process.env.HOST ?? "localhost";
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const hlsDir = process.env.HLS_DIR ?? "./hls";
// 40772はLinuxのエフェメラルポート
const mirakBaseUrl = (process.env.MIRAK_URL ?? "http://localhost:40772/").replace(/\/+$/, "") + "/api/";
const epgBaseUrl = (process.env.EPG_URL ?? "http://localhost:8888/").replace(/\/+$/, "") + "/api/";

const inputFile = process.argv[2] ?? process.env.INPUT_FILE;

const ws = websocket();

// EPGStationのパラメータ参照
const args = [
    "-dual_mono_mode", "main",
    "-i", "pipe:0",
    "-sn",
    "-threads", "0",
    "-c:a", "aac",
    "-ar", "48000",
    "-b:a", "192k",
    "-ac", "2",
    "-c:v", "libx264",
    "-vf", "yadif,scale=-2:720",
    "-b:v", "3000k",
    "-profile:v", "baseline",
    "-preset", "veryfast",
    "-tune", "fastdecode,zerolatency",
    "-movflags", "frag_keyframe+empty_moov+faststart+default_base_moof",
    "-y",
    "-analyzeduration", "10M",
    "-probesize", "32M",
    "-f", "mp4",
    "pipe:1",
];

const mpegtsArgs = [
    "-re",
    "-dual_mono_mode", "main",
    "-f", "mpegts",
    "-analyzeduration", "500000",
    "-i", "pipe:0",
    "-map", "0",
    "-c:s", "copy",
    "-c:d", "copy",
    "-ignore_unknown",
    "-fflags", "nobuffer",
    "-flags", "low_delay",
    "-max_delay", "250000",
    "-max_interleave_delta", "1",
    "-threads", "0",
    "-c:a", "aac",
    "-ar", "48000",
    "-b:a", "192k",
    "-ac", "2",
    "-c:v", "libx264",
    "-flags", "+cgop",
    "-vf", "yadif,scale=-2:720",
    "-b:v", "3000k",
    "-preset", "veryfast",
    "-y",
    "-f", "mpegts",
    "pipe:1",
];

function getHLSArguments(segmentFilename: string, manifestFilename: string): string[] {
    return [
        "-re",
        "-dual_mono_mode", "main",
        "-i", "pipe:0",
        "-sn",
        "-map", "0",
        "-threads", "0",
        "-ignore_unknown",
        "-max_muxing_queue_size", "1024",
        "-f", "hls",
        "-hls_time", "3",
        "-hls_list_size", "17",
        "-hls_allow_cache", "1",
        "-hls_segment_filename", segmentFilename,
        "-hls_flags", "delete_segments",
        "-c:a", "aac",
        "-ar", "48000",
        "-b:a", "192k",
        "-ac", "2",
        "-c:v", "libx264",
        "-vf", "yadif,scale=-2:720",
        "-b:v", "3000k",
        "-preset", "veryfast",
        "-flags", "+loop-global_header",
        manifestFilename,
    ]
};


function unicast(client: WebSocket, msg: wsApi.ResponseMessage) {
    client.send(JSON.stringify(msg));
}

const app = new Koa();
const router = new Router<any, WebSocketContext>();
function readFileAsync(path: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        fs.readFile(path, null, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    })
}


router.get('/arib.js', async ctx => {
    ctx.body = fs.createReadStream("dist/arib.js");
    ctx.set('Content-Type', 'text/javascript; charset=utf-8')
});

router.get('/arib.js.map', async ctx => {
    ctx.body = fs.createReadStream("dist/arib.js.map");
    ctx.set('Content-Type', 'application/json; charset=utf-8')
});

router.get('/remote_controller.js', async ctx => {
    ctx.body = fs.createReadStream("dist/remote_controller.js");
    ctx.set('Content-Type', 'text/javascript; charset=utf-8')
});

router.get('/remote_controller.js.map', async ctx => {
    ctx.body = fs.createReadStream("dist/remote_controller.js.map");
    ctx.set('Content-Type', 'application/json; charset=utf-8')
});

router.get("/remote_controller.html", async ctx => {
    ctx.body = fs.createReadStream("public/remote_controller.html");
    ctx.set("Content-Type", "text/html; charset=utf-8");
});

router.get('/default.css', async ctx => {
    ctx.body = fs.createReadStream("public/default.css");
    ctx.set('Content-Type', 'text/css; charset=utf-8')
});

router.get("/rounded-mplus-1m-arib.ttf", async ctx => {
    ctx.body = fs.createReadStream("dist/rounded-mplus-1m-arib.ttf");
});

// モトヤマルベリ
router.get("/KosugiMaru-Regular.ttf", async ctx => {
    ctx.body = fs.createReadStream("dist/KosugiMaru-Regular.ttf");
});
// モトヤシーダ
router.get("/Kosugi-Regular.ttf", async ctx => {
    ctx.body = fs.createReadStream("dist/Kosugi-Regular.ttf");
});
router.get('/api/sleep', async ctx => {
    let ms = Number(ctx.query.ms ?? "0");
    await new Promise<void>((resolve, reject) => {
        setTimeout(() => {
            resolve()
        }, ms);
    });
    ctx.body = "OK";
});

router.get('/video_list.js', async ctx => {
    ctx.body = fs.createReadStream("dist/video_list.js");
    ctx.set('Content-Type', 'text/javascript; charset=utf-8')
});

router.get('/video_list.js.map', async ctx => {
    ctx.body = fs.createReadStream("dist/video_list.js.map");
    ctx.set('Content-Type', 'application/json; charset=utf-8')
});

router.get("/", async ctx => {
    ctx.body = fs.createReadStream("public/video_list.html");
    ctx.set("Content-Type", "text/html; charset=utf-8");
});

router.get("/channels/:channelType/:channel/stream", async ctx => {
    ctx.body = fs.createReadStream("public/index.html");
    ctx.set("Content-Type", "application/xhtml+xml; charset=utf-8");
});

router.get("/channels/:channelType/:channel/services/:id/stream", async ctx => {
    ctx.body = fs.createReadStream("public/index.html");
    ctx.set("Content-Type", "application/xhtml+xml; charset=utf-8");
});

router.get("/videos/:videoFileId", async ctx => {
    ctx.body = fs.createReadStream("public/index.html");
    ctx.set("Content-Type", "application/xhtml+xml; charset=utf-8");
});

router.get("/play", async ctx => {
    ctx.body = fs.createReadStream("public/index.html");
    ctx.set("Content-Type", "application/xhtml+xml; charset=utf-8");
});

function pipeAsync(from: stream.Readable, to: stream.Writable, options?: { end?: boolean }): Promise<void> {
    return new Promise((resolve, reject) => {
        from.pipe(to, options);
        from.on('error', reject);
        from.on('end', resolve);
    });
}

app.use(ws);

// UUID => stream
const streams = new Map<string, DataBroadcastingStream>();
const max_number_of_streams = 4;

function closeDataBroadcastingLiveStream(dbs: DataBroadcastingStream) {
    if (!streams.has(dbs.id)) {
        return;
    }
    console.log("close live stream ", dbs.id);
    dbs.tsStream.unpipe();
    dbs.liveStream?.destroy();
    dbs.liveStream = undefined;
}

function closeDataBroadcastingStream(dbs: DataBroadcastingStream) {
    if (!streams.has(dbs.id)) {
        return;
    }
    closeDataBroadcastingLiveStream(dbs);
    console.log("close", dbs.id);
    // readStream->transformStream->tsStream->ffmpeg->response
    dbs.transformStream?.unpipe();
    dbs.readStream.unpipe();
    dbs.readStream.destroy();
    dbs.ws.close(4000);
    streams.delete(dbs.id);
}

function registerDataBroadcastingStream(dbs: DataBroadcastingStream): boolean {
    if (streams.size >= max_number_of_streams) {
        console.error("The maximum number of streams has been exceeded.");
        const oldest = [...streams.values()].sort((a, b) => (a.registeredAt.getTime() - b.registeredAt.getTime()));
        if (oldest[0] != null) {
            const msg = {
                type: "error",
                message: "The maximum number of streams has been exceeded.",
            } as wsApi.ResponseMessage;
            unicast(oldest[0].ws, msg);
            closeDataBroadcastingStream(oldest[0]);
        } else {
            return false;
        }
    }
    streams.set(dbs.id, dbs);
    return true;
}

function addProgramIdArgument(args: string[], serviceId?: number): string[] {
    if (serviceId == null) {
        return args;
    }
    const newArgs = args.slice();
    newArgs[newArgs.indexOf("-map") + 1] = `0:p:${serviceId}`;
    return newArgs;
}

router.get("/streams/:id.mp4", async (ctx) => {
    const dbs = streams.get(ctx.params.id);
    if (dbs == null) {
        return;
    }
    if (dbs.liveStream) {
        closeDataBroadcastingLiveStream(dbs);
    }
    const { tsStream } = dbs;
    ctx.set("Content-Type", "video/mp4");
    ctx.status = 200;

    tsStream.unpipe();
    dbs.liveStream = new LiveStream(ffmpeg, addProgramIdArgument(args, dbs.serviceId), dbs.tsStream);
    const ls = dbs.liveStream;
    dbs.liveStream.encoderProcess.on("error", (err) => {
        console.error("encoder proc err", err);
        tsStream.unpipe(ls.encoderProcess.stdin);
        ls.encoderProcess.stdout.unpipe();
    });
    ls.encoderProcess.on("close", (err) => {
        console.error("close proc err", err);
        tsStream.unpipe(ls.encoderProcess.stdin);
        ls.encoderProcess.stdout.unpipe();
    });
    tsStream.resume();
    ctx.res.on("error", (err) => {
        console.log("error res", dbs.id, dbs.source, err);
        closeDataBroadcastingLiveStream(dbs);
    });
    try {
        await pipeAsync(dbs.liveStream.encoderProcess.stdout, ctx.res, { end: true });
    } catch {
    }
    closeDataBroadcastingLiveStream(dbs);
});


router.get("/streams/:id.h264.m2ts", async (ctx) => {
    const dbs = streams.get(ctx.params.id);
    if (dbs == null) {
        return;
    }
    if (dbs.liveStream) {
        closeDataBroadcastingLiveStream(dbs);
    }
    const { tsStream } = dbs;
    ctx.set("Content-Type", "video/mp2t");
    ctx.status = 200;

    tsStream.unpipe();
    dbs.liveStream = new LiveStream(ffmpeg, addProgramIdArgument(mpegtsArgs, dbs.serviceId), dbs.tsStream);
    const ls = dbs.liveStream;
    dbs.liveStream.encoderProcess.on("error", (err) => {
        console.error("encoder proc err", err);
        tsStream.unpipe(ls.encoderProcess.stdin);
        ls.encoderProcess.stdout.unpipe();
    });
    ls.encoderProcess.on("close", (err) => {
        console.error("close proc err", err);
        tsStream.unpipe(ls.encoderProcess.stdin);
        ls.encoderProcess.stdout.unpipe();
    });
    tsStream.resume();
    ctx.res.on("error", (err) => {
        console.log("error res", dbs.id, dbs.source, err);
        closeDataBroadcastingLiveStream(dbs);
    });
    try {
        await pipeAsync(dbs.liveStream.encoderProcess.stdout, ctx.res, { end: true });
    } catch {
    }
    closeDataBroadcastingLiveStream(dbs);
});

mkdirSync(hlsDir, { recursive: true });
function cleanUpHLS() {
    for (const entry of fs.readdirSync(hlsDir, { withFileTypes: true })) {
        if (entry.name.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.m3u8|-[0-9]{9}\.ts)$/)) {
            fs.unlinkSync(path.join(hlsDir, entry.name));
        }
    }
}
cleanUpHLS();

router.get(/^\/streams\/(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?<segment>[0-9]{9})\.ts$/, async (ctx) => {
    const dbs = streams.get(ctx.params.id);
    if (dbs == null) {
        return;
    }
    ctx.body = await readFileAsync(path.join(hlsDir, ctx.params.id + "-" + ctx.params.segment + ".ts"));
});

function delayAsync(ms: number): Promise<void> {
    return new Promise((resolve, _reject) => {
        setTimeout(resolve, ms);
    });
}

router.get("/streams/:id.m3u8", async (ctx) => {
    const dbs = streams.get(ctx.params.id);
    if (dbs == null) {
        return;
    }
    const { tsStream } = dbs;
    if (dbs.liveStream instanceof HLSLiveStream) {
        ctx.body = await readFileAsync(path.join(hlsDir, dbs.id + ".m3u8"));
        return;
    }
    if (dbs.liveStream) {
        closeDataBroadcastingLiveStream(dbs);
    }
    tsStream.unpipe();
    const hlsLiveStream = new HLSLiveStream(ffmpeg, addProgramIdArgument(getHLSArguments(path.join(hlsDir, dbs.id + "-%09d.ts"), path.join(hlsDir, dbs.id + ".m3u8")), dbs.serviceId), dbs.tsStream);
    tsStream.resume();
    dbs.liveStream = hlsLiveStream;
    const pollingTime = 100;
    let limitTime = 60 * 1000;
    while (limitTime > 0) {
        if (fs.existsSync(path.join(hlsDir, dbs.id + ".m3u8"))) {
            ctx.body = await readFileAsync(path.join(hlsDir, dbs.id + ".m3u8"));
            return;
        }
        await delayAsync(pollingTime);
        limitTime -= pollingTime;
    }
});



router.get("/streams/:id.null", async (ctx) => {
    const dbs = streams.get(ctx.params.id);
    if (dbs == null) {
        return;
    }
    const { tsStream } = dbs;
    if (dbs.liveStream) {
        closeDataBroadcastingLiveStream(dbs);
    }
    tsStream.unpipe();
    tsStream.resume();
});

async function streamToString(stream: stream.Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf-8");
}

function httpGetAsync(options: string | http.RequestOptions | URL): Promise<http.IncomingMessage> {
    return new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.get(options, (res) => {
            resolve(res);
        });
        req.on("error", reject);
    });
}

router.get("/api/channels", async (ctx) => {
    const response = await httpGetAsync(mirakBaseUrl + "channels");
    ctx.body = JSON.parse(await streamToString(response));
    if (response.statusCode != null) {
        ctx.status = response.statusCode;
    }
});

router.get("/api/recorded", async (ctx) => {
    const response = await httpGetAsync(epgBaseUrl + "recorded?" + ctx.querystring);
    ctx.body = JSON.parse(await streamToString(response));
    if (response.statusCode != null) {
        ctx.status = response.statusCode;
    }
});

router.get("/api/streams", async (ctx) => {
    ctx.body = [...streams.values()].sort((a, b) => a.registeredAt.getTime() - b.registeredAt.getTime()).map(x => (
        {
            id: x.id,
            registeredAt: x.registeredAt.getTime(),
            encoderProcessId: x.liveStream?.encoderProcess.pid,
            source: x.source,
        }
    ));
    ctx.status = 200;
});

router.get('/api/ws', async (ctx) => {
    if (!ctx.ws) {
        return;
    }
    let readStream: stream.Readable;
    let size = 0;
    let source: string;
    let serviceId: number | undefined;
    // とりあえず手動validate
    const query: any = typeof ctx.query.param === "string" ? (JSON.parse(ctx.query.param) ?? {}) : {};
    if (typeof query.demultiplexServiceId == "number") {
        serviceId = (query as wsApi.Param).demultiplexServiceId;
    }
    if (query.type === "mirakLive" && typeof query.channelType === "string" && typeof query.channel === "string" && (query.serviceId == null || typeof query.serviceId == "number")) {
        const q = query as wsApi.MirakLiveParam;
        if (q.serviceId == null) {
            source = mirakBaseUrl + `channels/${encodeURIComponent(q.channelType)}/${encodeURIComponent(q.channel)}/stream`;
        } else {
            source = mirakBaseUrl + `channels/${encodeURIComponent(q.channelType)}/${encodeURIComponent(q.channel)}/services/${q.serviceId}/stream`;
            serviceId = undefined;
        }
        const res = await httpGetAsync(source);
        readStream = res;
    } else if (query.type === "epgStationRecorded" && typeof query.videoFileId === "number") {
        const q = query as wsApi.EPGStationRecordedParam;
        source = epgBaseUrl + `videos/${q.videoFileId}`;
        const res = await httpGetAsync(source);
        readStream = res;
        const len = Number.parseInt(res.headers["content-length"] || "NaN");
        if (Number.isFinite(len)) {
            size = len;
        }
    } else {
        if (inputFile === "-" || inputFile == null) {
            source = "stdin";
            readStream = process.stdin;
        } else {
            source = inputFile;
            readStream = fs.createReadStream(inputFile);
            size = fs.statSync(inputFile).size;
        }
    }
    const ws = await ctx.ws();
    const id = randomUUID();
    const tsStream = new TsStream();

    const dbs: DataBroadcastingStream = {
        id,
        registeredAt: new Date(),
        readStream,
        tsStream,
        size,
        ws,
        source,
        serviceId,
    };
    if (!registerDataBroadcastingStream(dbs)) {
        const msg = {
            type: "error",
            message: "The maximum number of streams has been exceeded.",
        } as wsApi.ResponseMessage;
        unicast(dbs.ws, msg);
        closeDataBroadcastingStream(dbs);
        return;
    }

    readStream.on("error", (err) => {
        console.error("err readStream", dbs.id, dbs.source);
        closeDataBroadcastingStream(dbs);
    });

    readStream.on("close", () => {
        console.error("close readStream", dbs.id, dbs.source);
        closeDataBroadcastingStream(dbs);
    });

    tsStream.pause();
    decodeTS(dbs);

    ws.on("error", (_code: number, _reason: Buffer) => {
        console.error("err ws", dbs.id, dbs.source);
        closeDataBroadcastingStream(dbs);
    });

    ws.on("close", (_code: number, _reason: Buffer) => {
        console.error("close ws", dbs.id, dbs.source);
        closeDataBroadcastingStream(dbs);
    });

    ws.on("message", (message) => {
        const _ = JSON.parse(message.toString("utf-8")) as wsApi.RequestMessage;
    });

    unicast(ws, {
        type: "videoStreamUrl",
        videoStreamUrl: "/streams/" + id,
    });
});

app
    .use(router.routes())
    .use(router.allowedMethods());

app.listen(port, host);

console.log(`listening on ${host}:${port}`);
