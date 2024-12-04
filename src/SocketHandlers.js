const Room      = require('./Room');
const Peer      = require('./Peer');

module.exports  = (io, roomList, workers, logger) => {
    io.on("connection", (socket) => {
        const { roomId, userId } = socket.handshake.query;

        if (!roomList.has(roomId)) {
            const worker = workers.shift();
            roomList.set(roomId, new Room(roomId, worker, io));
            workers.push(worker);
        }

        const currentRoom = roomList.get(roomId);
        currentRoom.addPeer(new Peer(socket.id, userId));
        socket.roomId = roomId;

        logger.info("User joined", { roomId, userId });

        socket.on("getProducers", () => {
            logger.info('Get producers',{userId:userId});
            const producers = currentRoom.getProducerListForPeer();
            socket.emit("newProducers", producers);
        });

        socket.on("createWebRtcTransport", async (_, callback) => {
            logger.info('Create webrtc transport', { userId: userId });
            try {
                const { params } = await currentRoom.createWebRtcTransport(socket.id);
                callback(params);
            } catch (err) {
                logger.error(err);
                callback({ error: err.message });
            }
        });

        socket.on('getRouterRtpCapabilities', (_, callback) => {
            logger.info('Get RouterRtpCapabilities', { userId: userId });

            try {
                callback(currentRoom.getRtpCapabilities())
            } catch (e) {
                callback({
                    error: e.message
                })
            }
        })

        socket.on("connectTransport", async ({ transport_id, dtlsParameters }, callback) => {
            logger.info('Connect transport', { userId: userId });
            await currentRoom.connectPeerTransport(socket.id, transport_id, dtlsParameters);
            callback("success");
        });

        socket.on("produce", async ({ kind, rtpParameters, producerTransportId }, callback) => {
            const producerId = await currentRoom.produce(socket.id, producerTransportId, rtpParameters, kind);
            logger.info("Produce", { kind, userId, producerId });
            callback({ producerId });
        });

        socket.on('producerClosed', ({ producer_id }) => {
            logger.info('Producer close', { roomId , userId});
            currentRoom.closeProducer(socket.id, producer_id);
        })

        socket.on("consume", async ({ consumerTransportId, producerId, rtpCapabilities }, callback) => {
            try {
                const params = await currentRoom.consume(socket.id, consumerTransportId, producerId, rtpCapabilities);
                logger.info('Consuming', { userId,producerId, consumer_id: `${params.id}`});
                callback(params);
            } catch (err) {
                logger.error(err);
                callback({ error: err.message });
            }
        });

        socket.on('getMyRoomInfo', (_, callback) => {
            callback(currentRoom.toJson());
        })

        socket.on("disconnect", () => {
            currentRoom.removePeer(socket.id);
            if (currentRoom.getPeers().size === 0) {
                roomList.delete(roomId);
            }
            logger.info("User disconnected", { roomId, userId });
        });

        socket.on("exitRoom", async (_, callback) => {
            logger.info('Exit room', { roomId , userId});
            await currentRoom.removePeer(socket.id);
            if (currentRoom.getPeers().size === 0) {
                roomList.delete(roomId);
            }
            socket.roomId = null;
            callback("success");
        });
    });
};
