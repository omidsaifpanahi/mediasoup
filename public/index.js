if (location.href.substr(0, 5) !== 'https') location.href = 'https' + location.href.substr(4, location.href.length - 4)

const urlParams = new URLSearchParams(window.location.search);
const roomId    = urlParams.get("roomId");
const userId    = urlParams.get("userId");
const server    = `wss://?roomId=${roomId}&userId=${userId}`;
const socket    = io(server, {
  path: "/webcam/",
  // ackTimeout: 10000,
  // retries: 3,
  transport : ['websocket'],
});

let producer = null;


socket.request = function request(type, data = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(type, data, (data) => {
      if (data.error) {
        reject(data.error);
      } else {
        resolve(data);
      }
    })
  })
}

let rc = null;

function joinRoom() {
  if (rc && rc.isOpen()) {
    console.log('Already connected to a room');
  } else {
    initEnumerateDevices();

    rc = new RoomClient(localMedia, remoteVideos, remoteAudios, window.mediasoupClient, socket, roomId, userId, roomOpen);

    addListeners();
  }
}

function roomOpen() {
  hide(stopAudioButton);
  hide(stopVideoButton);
  hide(stopScreenButton);
  // reveal(videoMedia);
}

function hide(elem) {
  elem.classList.add('d-none');
}

function reveal(elem) {
  elem.classList.remove("d-none");
}

function addListeners() {
  rc.on(RoomClient.EVENTS.startScreen, () => {
    hide(startScreenButton);
    reveal(stopScreenButton);
  })

  rc.on(RoomClient.EVENTS.stopScreen, () => {
    hide(stopScreenButton);
    reveal(startScreenButton);
  })

  rc.on(RoomClient.EVENTS.stopAudio, () => {
    hide(stopAudioButton);
    reveal(startAudioButton);
  })
  rc.on(RoomClient.EVENTS.startAudio, () => {
    hide(startAudioButton);
    reveal(stopAudioButton);
  })

  rc.on(RoomClient.EVENTS.startVideo, () => {
    hide(startVideoButton);
    reveal(stopVideoButton);
  })
  rc.on(RoomClient.EVENTS.stopVideo, () => {
    hide(stopVideoButton);
    reveal(startVideoButton);
  })
}

let isEnumerateDevices = false

function initEnumerateDevices() {
  // Many browsers, without the consent of getUserMedia, cannot enumerate the devices.
  if (isEnumerateDevices) return;

  const constraints = {
    audio: true,
    video: true
  };

  navigator.mediaDevices
    .getUserMedia(constraints)
    .then((stream) => {
      enumerateDevices();
      stream.getTracks().forEach(function (track) {
        track.stop();
      })
    })
    .catch((err) => {
      console.error('Access denied for audio/video: ', err);
    })
}

function enumerateDevices() {
  // Load mediaDevice options
  navigator.mediaDevices.enumerateDevices().then((devices) =>
    devices.forEach((device) => {

      let el = null;

      if ( 'audioinput' === device.kind ) {
        el = audioSelect;
      } else if ( 'videoinput' === device.kind ) {
        el = videoSelect;
      }

      if (!el) return;

      let option = document.createElement('option');
      option.value = device.deviceId;
      option.innerText = device.label;
      el.appendChild(option);

      // let temp = document.createElement('span');
      // temp.innerText = device.kind +'-'+ device.label;
      // temp.className    = 'text text-warning';
      // devicesList.appendChild(temp);
      // let temp2 = document.createElement('br');
      // devicesList.appendChild(temp2);
      isEnumerateDevices = true;
    })
  )
}

joinRoom();