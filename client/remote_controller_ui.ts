import { RemoteControllerMessage } from "./remote_controller";

function postMessage(msg: RemoteControllerMessage) {
    window.parent.postMessage({ remoteController: msg });
}

document.body.addEventListener("keydown", e => {
    e.preventDefault();
    postMessage({ type: "keydown", key: e.key });
});

document.body.addEventListener("keyup", e => {
    e.preventDefault();
    postMessage({ type: "keyup", key: e.key });
});

document.querySelectorAll("button").forEach(x => {
    x.addEventListener("click", () => {
        if (x.id === "unmute" || x.id === "mute" || x.id === "play" || x.id === "pause" || x.id === "cc" || x.id === "disable-cc" || x.id === "zoom-100" || x.id === "zoom-150" || x.id === "zoom-200") {
            postMessage({ type: x.id });
        } else {
            postMessage({ type: "button", keyCode: Number.parseInt(x.id.split("key")[1]) });
        }
    });
});

postMessage({ type: "load" });
