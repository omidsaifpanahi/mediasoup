const mediaType = {
  audio : 'audioType',
  video : 'videoType',
  screen: 'screenType'
};

const _EVENTS = {
  exitRoom    : 'exitRoom',
  openRoom    : 'openRoom',
  startVideo  : 'startVideo',
  stopVideo   : 'stopVideo',
  startAudio  : 'startAudio',
  stopAudio   : 'stopAudio',
  startScreen : 'startScreen',
  stopScreen  : 'stopScreen'
};

class RoomClient {
   constructor(localMediaEl, remoteVideoEl, remoteAudioEl, mediasoupClient, socket, roomId, userId, successCallback) {
     this.userId             = userId;
    this.localMediaEl        = localMediaEl;
    this.remoteVideoEl       = remoteVideoEl;
    this.remoteAudioEl       = remoteAudioEl;
    this.mediasoupClient     = mediasoupClient;

    this.socket              = socket;
    this.producerTransport   = null;
    this.consumerTransport   = null;
    this.device              = null;
    this.roomId              = roomId;

    this.isVideoOnFullScreen = false;
    this.isDevicesVisible    = false;

    this.consumers           = new Map();
    this.producers           = new Map();

    console.log('Mediasoup client', mediasoupClient)

    /**
     * map that contains a mediatype as key and producer_id as value
     */
    this.producerLabel       = new Map();

    this._isOpen             = false;
    this.eventListeners      = new Map();


     Object.keys(_EVENTS).forEach((evt) => {
       this.eventListeners.set(evt, []);
     });

     this.getRouterRtpCapabilities().then(async () => {
       this.initSockets();
       this._isOpen = true;
       successCallback();
     });
  }

  ////////// INIT /////////
  async getRouterRtpCapabilities(){
    const data = await this.socket.request('getRouterRtpCapabilities')
    let device = await this.loadDevice(data)
    this.device = device
    await this.initTransports(device)
    this.socket.emit('getProducers')
  }

  async loadDevice(routerRtpCapabilities) {
    let device
    try {
      device = new this.mediasoupClient.Device()
    } catch (error) {
      if (error.name === 'UnsupportedError') {
        console.error('Browser not supported')
        alert('Browser not supported')
      }
      console.error(error)
    }
    await device.load({
      routerRtpCapabilities
    })
    return device
  }

  async initTransports(device) {
  // init producerTransport
  {
    const data = await this.socket.request('createWebRtcTransport', {
      forceTcp: false,
      rtpCapabilities: device.rtpCapabilities,
    });

    if (data.error) {
      console.error(data.error);
      return;
    }

    this.producerTransport = device.createSendTransport(data);

    this.producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      this.socket
        .request('connectTransport', {
          dtlsParameters,
          transport_id: data.id,
        })
        .then(callback)
        .catch(errback);
    });

    this.producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
      try {
        const { producerId } = await this.socket.request('produce', {
          producerTransportId: this.producerTransport.id,
          kind,
          rtpParameters,
        });
        callback({ id: producerId });
      } catch (err) {
        errback(err);
      }
    });

    this.producerTransport.on('connectionstatechange', (state) => {
      switch (state) {
        case 'connecting':
          break;

        case 'connected':
          //localVideo.srcObject = stream
          break;

        case 'failed':
          this.producerTransport.close();
          break;

        default:
          break;
      }
    });
  }

  // init consumerTransport
  {
    const data = await this.socket.request('createWebRtcTransport', {
      forceTcp: false,
    });

    if (data.error) {
      console.error(data.error);
      return;
    }

    // only one needed
    this.consumerTransport = device.createRecvTransport(data);
    this.consumerTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.socket
        .request('connectTransport', {
          transport_id: this.consumerTransport.id,
          dtlsParameters,
        })
        .then(callback)
        .catch(errback);
    });

    this.consumerTransport.on('connectionstatechange', async (state) => {
      switch (state) {
        case 'connecting':
          break;

        case 'connected':
          //remoteVideo.srcObject = await stream;
          //await socket.request('resume');
          break;

        case 'failed':
          this.consumerTransport.close();
          break;

        default:
          break;
      }
    });
  }
}

  initSockets() {
    this.socket.on('consumerClosed', ({ consumer_id }) => {
      console.log('Closing consumer:', consumer_id);
      this.removeConsumer(consumer_id);
    });

    /**
     * data: [ {
     *  producer_id:
     *  producer_socket_id:
     * }]
     */
    this.socket.on('newProducers', async (data) => {
      console.log('New producers', data);
      for (let { producer_id } of data) {
        await this.consume(producer_id);
      }
    });

    this.socket.on('disconnect', () => {
      this.exit(true);
    });
  }

  //////// MAIN FUNCTIONS /////////////

  async produce(type, deviceId = null) {
    let mediaConstraints = {};
    let audio            = false;
    let screen           = false;

    switch (type)
    {
      case mediaType.audio:
        mediaConstraints = { audio: { deviceId: deviceId },  video: false };
        audio            = true;
      break;

      case mediaType.video:
        mediaConstraints = {
          audio: false,
          video: {
            width: {
              min: 320,
              max: 640,
              ideal: 320
            },
            height: {
              min: 180,
              max: 360,
              ideal: 180
            },
            deviceId: deviceId,
            aspectRatio: {
              ideal: 16/9
            }
          }
        };
      break;

      case mediaType.screen:
        mediaConstraints = false;
        screen           = true;
      break;

      default:
        return;
    }

    if (!this.device.canProduce('video') && !audio) {
      console.error('Cannot produce video');
      return;
    }

    if (this.producerLabel.has(type)) {
      console.log('Producer already exists for this type ' + type);
      return;
    }

    console.log('Mediacontraints:', mediaConstraints);

    let stream;

    try {
      stream = (screen==true) ? await navigator.mediaDevices.getDisplayMedia({ video: true,
      }) : await navigator.mediaDevices.getUserMedia(mediaConstraints);
      console.log( 'SupportedConstraints:', navigator.mediaDevices.getSupportedConstraints() );

      const track  = (audio ==true) ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      const params = { track };

      if ( !audio && !screen )
      {
        params.encodings = [
          {
            rid: 'r0',
            maxBitrate: 150000,
            scaleResolutionDownBy: 1.0,
            // scalabilityMode: 'S1T3',
            // scalabilityMode: 'L3T3'
          },
        ];

        params.codecOptions = {
          videoGoogleStartBitrate: 150
        };
      };

      producer = await this.producerTransport.produce(params);

      this.producers.set(producer.id, producer);

      let element;

      if (!audio)
      {
        element              = document.createElement('video');
        element.srcObject    = stream;
        element.id           = producer.id;
        element.playsinline  = false;
        element.autoplay     = true;
        element.className    = 'vid';
        element.style.width = '100%';

        this.localMediaEl.appendChild(element);
        this.handleFS(element.id);
      }

      producer.on('trackended', () => {
        this.closeProducer(type)
      });

      producer.on('transportclose', () => {
        console.log('Producer transport close');

        if (!audio)
        {
          element.srcObject.getTracks().forEach(function (track) { track.stop() });
          element.parentNode.removeChild(element);
        }

        this.producers.delete(producer.id);
      })

      producer.on('close', () => {
        console.log('Closing producer');

        if (!audio)
        {
          element.srcObject.getTracks().forEach(function (track) { track.stop() });
          element.parentNode.removeChild(element);
        }

        this.producers.delete(producer.id);
      })
      this.producerLabel.set(type, producer.id);

      switch (type)
      {
        case mediaType.audio:
          this.event(_EVENTS.startAudio);
        break;

        case mediaType.video:
          this.event(_EVENTS.startVideo);
        break;

        case mediaType.screen:
          this.event(_EVENTS.startScreen);
        break;

        default:
          return;
      }
    } catch (err) {
      console.log('Produce error:', err);
    }
  }

  async consume(producer_id) {
    try {
      const { consumer, stream, kind } = await this.getConsumeStream(producer_id);
      this.consumers.set(consumer.id, consumer);

      const element = this.createMediaElement(kind, consumer.id, stream, producer_id);

      if (kind === 'video') {
        this.remoteVideoEl.appendChild(element);
        this.handleFS(element.id);
      } else {
        this.remoteAudioEl.appendChild(element);
      }

      consumer.on('trackended', () => this.removeConsumer(consumer.id));
      consumer.on('transportclose', () => this.removeConsumer(consumer.id));
    } catch (error) {
      console.error('Error consuming stream:', error);
    }
  }

  createMediaElement(kind, id, stream, producer_id) {
    const element = document.createElement(kind === 'video' ? 'video' : 'audio');
    Object.assign(element, {
      srcObject: stream,
      id: id,
      playsInline: false,
      autoplay: true,
      className: kind === 'video' ? 'vid col-4 mb-1 prod-'+producer_id : '',
    });
    return element;
  }

  async getConsumeStream(producerId) {

    const { rtpCapabilities } = this.device;

    const data = await this.socket.request('consume', {
      rtpCapabilities,
      consumerTransportId: this.consumerTransport.id,
      producerId
    });

    const { id, kind, rtpParameters } = data;

    let codecOptions = {};

    const consumer   = await this.consumerTransport.consume({
      id,
      producerId,
      kind,
      rtpParameters,
      codecOptions
    });

    const stream = new MediaStream();
    stream.addTrack(consumer.track);

    return {
      consumer,
      stream,
      kind
    };
  }

  closeProducer(type) {
    if (!this.producerLabel.has(type)) {
      console.log('There is no producer for this type ' + type)
      return
    }

    let producer_id = this.producerLabel.get(type)
    console.log('Close producer', producer_id,type)

    this.socket.emit('producerClosed', {
      producer_id
    })

    this.producers.get(producer_id).close()
    this.producers.delete(producer_id)
    this.producerLabel.delete(type)

    if (type !== mediaType.audio) {
      let elem = document.getElementById(producer_id)
      elem.srcObject.getTracks().forEach(function (track) {
        track.stop()
      })
      elem.parentNode.removeChild(elem)
    }

    switch (type) {
      case mediaType.audio:
        this.event(_EVENTS.stopAudio)
        break
      case mediaType.video:
        this.event(_EVENTS.stopVideo)
        break
      case mediaType.screen:
        this.event(_EVENTS.stopScreen)
        break
      default:
        return
    }
  }

  removeConsumer(consumer_id) {
    let element = document.getElementById(consumer_id);

    element.srcObject.getTracks().forEach(function (track) {
      track.stop();
    });

    element.parentNode.removeChild(element);
    this.consumers.delete(consumer_id);
  }

  exit(offline = false) {
    let clean = function () {
      this._isOpen = false
      this.consumerTransport.close()
      this.producerTransport.close()
      this.socket.off('disconnect')
      this.socket.off('newProducers')
      this.socket.off('consumerClosed')
    }.bind(this)

    if (!offline) {
      this.socket
        .request('exitRoom')
        .then((e) => console.log(e))
        .catch((e) => console.warn(e))
        .finally(
          function () {
            clean()
          }.bind(this)
        )
    } else {
      clean()
    }

    this.event(_EVENTS.exitRoom)
  }

  ///////  HELPERS //////////

  async roomInfo() {
    let info = await this.socket.request('getMyRoomInfo');
    return info;
  }

  static get mediaType() {
    return mediaType;
  }

  event(evt) {
    if (this.eventListeners.has(evt))
    {
      this.eventListeners.get(evt).forEach((callback) => callback());
    }
  }

  on(evt, callback) {
    this.eventListeners.get(evt).push(callback);
  }

  //////// GETTERS ////////

  isOpen() {
    return this._isOpen;
  }

  static get EVENTS() {
    return _EVENTS;
  }

  //////// UTILITY ////////

  handleFS(id) {
    let videoPlayer = document.getElementById(id);

    videoPlayer.addEventListener('fullscreenchange', (e) => {

      if (videoPlayer.controls) return;

      if ( !document.fullscreenElement )
      {
        videoPlayer.style.pointerEvents = 'auto';
        this.isVideoOnFullScreen        = false;
      }
    });

    videoPlayer.addEventListener('webkitfullscreenchange', (e) => {

      if (videoPlayer.controls) return;

      if ( !document.webkitIsFullScreen ) {
        videoPlayer.style.pointerEvents = 'auto';
        this.isVideoOnFullScreen        = false;
      }

    });

    videoPlayer.addEventListener('click', (e) => {

      if (videoPlayer.controls) return;

      if (!this.isVideoOnFullScreen)
      {
        if (videoPlayer.requestFullscreen) {
          videoPlayer.requestFullscreen();
        }

        else if (videoPlayer.webkitRequestFullscreen) {
          videoPlayer.webkitRequestFullscreen();
        }

        else if (videoPlayer.msRequestFullscreen) {
          videoPlayer.msRequestFullscreen()
        }

        this.isVideoOnFullScreen        = true;
        videoPlayer.style.pointerEvents = 'none';
      }
      else
      {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
        else if (document.webkitCancelFullScreen) {
          document.webkitCancelFullScreen();
        }
        else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }

        this.isVideoOnFullScreen        = false;
        videoPlayer.style.pointerEvents = 'auto';
      }
    })
  }
}
