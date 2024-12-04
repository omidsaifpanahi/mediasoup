const config = require('./config');
const logger = require("./logger");

module.exports = class Room {

  constructor(room_id, worker, io) {
    this.id = room_id;
    const mediaCodecs = config.mediasoup.router.mediaCodecs;

    worker.createRouter({mediaCodecs}).then((router) => {
      this.router = router;
    });

    this.peers = new Map();
    this.io    = io;
  }

  addPeer(peer) {
    this.peers.set(peer.id, peer);
  }

  getProducerListForPeer() {
    let producerList = [];

    this.peers.forEach((peer) => {
      peer.producers.forEach((producer) => {
        producerList.push({ producer_id: producer.id });
      });
    });

    return producerList;
  }

  getRtpCapabilities() {
    return this.router.rtpCapabilities;
  }

  async createWebRtcTransport(socket_id) {
    const { maxIncomingBitrate, initialAvailableOutgoingBitrate } = config.mediasoup.webRtcTransport;
    const options = {
      listenIps: config.mediasoup.webRtcTransport.listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate
    };

    const transport = await this.router.createWebRtcTransport(options);
    if (maxIncomingBitrate) {
      try {
        await transport.setMaxIncomingBitrate(maxIncomingBitrate)
      } catch (error) {}
    }

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        logger.info('Transport close', { userId: this.peers.get(socket_id).userId });
        transport.close();
      }
    });

    transport.on('close', () => {
      logger.info('Transport close', { userId: this.peers.get(socket_id).userId });
    });

    logger.info('Adding transport', { transportId: transport.id });

    this.peers.get(socket_id).addTransport(transport);

    return {
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      }
    };
  }

  async connectPeerTransport(socket_id, transport_id, dtlsParameters) {
    if (!this.peers.has(socket_id)) return;

    await this.peers.get(socket_id).connectTransport(transport_id, dtlsParameters);
  }

  async produce(socket_id, producerTransportId, rtpParameters, kind) {
    // handle undefined errors
    return new Promise(async (resolve, reject) => {
      let producer = await this.peers.get(socket_id).createProducer(producerTransportId, rtpParameters, kind);

      resolve(producer.id);
      let options = [{
        producer_id: producer.id,
        producer_socket_id: socket_id
      }];

      this.broadCast(socket_id, 'newProducers', options);
    });
  }

  async consume(socket_id, consumer_transport_id, producer_id, rtpCapabilities) {
    // handle nulls
    if (!this.router.canConsume({ producerId: producer_id, rtpCapabilities })) {
      logger.error('can not consume');
      return null;
    }

    let { consumer, params } = await this.peers.get(socket_id).createConsumer(consumer_transport_id, producer_id, rtpCapabilities);

    consumer.on('producerclose', () => {
      logger.info('Consumer closed due to producerclose event', { userId: `${this.peers.get(socket_id).userId}`, consumer_id: `${consumer.id}` });

      this.peers.get(socket_id).removeConsumer(consumer.id);
      this.io.to(socket_id).emit('consumerClosed', { consumer_id: consumer.id });
    });

    return params;
  }

  async removePeer(socket_id) {
    this.peers.get(socket_id).close();
    this.peers.delete(socket_id);
  }

  closeProducer(socket_id, producer_id) {
    this.peers.get(socket_id).closeProducer(producer_id);
  }

  broadCast(socket_id, name, data) {
    for (let otherID of Array.from(this.peers.keys()).filter((id) => id !== socket_id)) {
      this.send(otherID, name, data);
    }
  }

  send(socket_id, name, data) {
    this.io.to(socket_id).emit(name, data);
  }

  getPeers() {
    return this.peers;
  }

  toJson() {
    return {
      id: this.id,
      peers: JSON.stringify([...this.peers])
    };
  }
}
