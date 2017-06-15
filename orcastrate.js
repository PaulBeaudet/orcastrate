// paymentNotificationServer.js ~ Copyright 2016 Mancehster Makerspace ~ MIT License
var ASPAYMENTLISTENER = 'paymentListener'; // distintive ids for server alter egos
var ASMASTERSLACKER = 'masterSlacker';     // second role as slack server

var bot = { // logic for adding a removing bot integrations
    s: [], // array where we store properties and functions of connected sevices
    create: function(packet, socketId){
        var newBot = {
            socketId: socketId,
            disconnectMsg: packet.goodBye
        };
        if(packet.name){ // Original cloud relay case
            newBot.username = packet.name;
        } else {         // master slacker case
            newBot.username = packet.slack.username;
            newBot.iconEmoji = packet.slack.iconEmoji;
            newBot.webhook = new slack.webhook(process.env.SLACK_WEBHOOK_URL, packet.slack);
        }
        bot.s.push(newBot);
        slack.send(ASMASTERSLACKER)(newBot.username + ' just connected');
    },
    disconnect: function(socketId){                                             // hold socketId information in closure
        return function socketDisconnect(){
            bot.do(socketId, function removeBot(index){
                var UTCString = new Date().toUTCString();                       // get a string of current time
                console.log(bot.s[index].username+' disconnecting '+UTCString); // give a warning when a bot is disconnecting
                slack.send(ASMASTERSLACKER)(bot.s[index].username + ' is disconnecting');
                if(bot.s[index].disconnectMsg){
                    bot.s[index].webhook.send(bot.s[index].disconnectMsg);      // one last thing wont happen on falling asleep
                }
                bot.s.splice(index, 1);                                         // given its there remove bot from bots array
            });
        };
    },
    do: function(socketId, foundCallback){               // executes a callback with one of our bots based on socket id
        var botNumber = bot.s.map(function(eachBot){
            return eachBot.socketId;
        }).indexOf(socketId);                            // figure index bot in our bots array
        if(botNumber > -1){                              // NOTE we remove bots keeping ids in closure would be inaccurate
            foundCallback(botNumber);                    // part where do happens
        } else {
            console.log(socketId + ':found no bot?');    // service is not there? Should never happen but w.e.
        }
    },
    listEm: function(){
        var msg = 'services connected, ';                // message to build on
        for(var i = 0; i < bot.s.length; i++){           // iterate through connected services
            msg += bot.s[i].username;                    // add services name
            if(i === (bot.s.length - 1)){msg+='.';}      // given last in array concat .
            else                        {msg+=' and ';}  // given not last in array concat and
        }
        return msg;                                      // send message so that we know whos connected
    }
};

var slack = {
    webhook: require('@slack/client').IncomingWebhook,   // url to slack intergration called "webhook" can post to any channel as a "bot"
    init: function(){
        var paymentListener = {                          // webhook object to act as payment Listener
            slack: {
                username: 'Payment Listener',
                channel: 'renewals',
                iconEmoji: ':moneybag:'
            }
        };
        var masterSlacker = {                            // webhook object to act as slack intergration server
            slack: {
                username: 'Doorboto Cloud Relay',
                channel: 'master_slacker',
                iconEmoji: ':slack:'
            }
        };
        bot.create(paymentListener, ASPAYMENTLISTENER);  // create internal intergration array items
        bot.create(masterSlacker, ASMASTERSLACKER);
    },
    send: function(socketId){
        return function msgEvent(msg){
            bot.do(socketId, function gotBot(botNumber){
                bot.s[botNumber].webhook.send(msg);
            });
        };
    },
    pm: function(socketId){
        return function pmMember(pmPayload){
            bot.do(socketId, function myBot(botNumber){
                var tempHook = new slack.webhook(process.env.SLACK_WEBHOOK_URL, {
                    username: bot.s[botNumber].username,    // reuse name of bot
                    channel: '@' + pmPayload.userhandle,    // note that we dont need @ as just name is stored in our db
                    iconEmoji: bot.s[botNumber].iconEmoji,  // reuse handle
                });
                tempHook.send(pmPayload.msg); // send pm
            });
        };
    }
};

// NOTE cannels and groups are distinctely differant. Groups are private denoted in folling ids with a 'g'. Channels can be joined by any invited team member
//  groups                                                whosAtTheSpace                                                                  Ourfrontdor
var AUTO_INVITE_CHANNELS = '&channels=C050A22AL,C050A22B2,G2ADCCBAP,C0GB99JUF,C29L2UMDF,C0MHNCXGV,C1M5NRPB5,C14TZJQSY,C1M6THS3E,C1QCBJ5D3,G391Q3DGX';
var slackAdmin = {                                                         // uses slack api for adminastrative functions (needs admin token)
    request: require('request'),                                           // needed to make post request to slack api
    invite: function(socketId){
        return function onInvite(email){
            bot.do(socketId, function foundbot(botNumber){
                var request = '&email=' + email + AUTO_INVITE_CHANNELS;    // NOTE: has to be a valid email, no + this or that
                var inviteAPIcall = 'https://slack.com/api/users.admin.invite?token=' + process.env.SLACK_TOKEN + requets;
                slackAdmin.request.post(inviteAPIcall, function requestRes(error, response, body){
                    var msg = 'NOT MADE';                                                // default to returning a possible error message
                    if(error){msg = 'request error:' + error;}  // post request error
                    else if (response.statusCode == 200){                          // give a good status code
                        body = JSON.parse(body);
                        if(body.ok){                                               // check if reponse body ok
                            msg = 'invite pending';                                // if true, success!
                        } else {                                                   // otherwise
                            if(body.error){msg = ' response error ' + body.error;} // log body error
                        }
                    } else { msg = 'error status ' + response.statusCode; }        // log different status code maybe expecting possible 404 not found or 504 timeout
                    bot.s[botNumber].webhook.send(msg);
                });
            });
        };
    }
};

var socket = {                                                         // socket.io singleton: handles socket server logic
    io: require('socket.io'),                                          // grab socket.io library
    listen: function(server){                                          // create server and setup on connection events
        socket.io = socket.io(server);                                 // specify http server to make connections w/ to get socket.io object
        socket.io.on('connection', function(client){                   // client holds socket vars and methods for each connection event
            console.log('client connected:'+ client.id);               // notify when clients get connected to be assured good connections
            client.on('authenticate', socket.auth(client));            // initially clients can only ask to authenticate
        }); // basically we want to authorize our users before setting up event handlers for them or adding them to emit whitelist
    },
    auth: function(client){                                                   // hold socketObj/key in closure, return callback to authorize user
        return function(authPacket){                                          // data passed from service {token:"valid token", name:"of service"}
                                                                              // make sure we are connected w/ a trusted source with a name
            if(authPacket.token === process.env.AUTH_TOKEN && (authPacket.slack.username || authPacket.name)){
                bot.create(authPacket, client.id);                            // add all authorized connections to an array
                client.on('msg', slack.send(client.id));                      // Send slack message on behalf of this service as this service
                client.on('slackMsg', slack.send(ASPAYMENTLISTENER));         // relay this message as payment listener
                client.on('invite', slackAdmin.invite(client.id));            // invite new members to slack
                client.on('pm', slack.pm(client.id));                         // personal message members
                client.on('disconnect', bot.disconnect(client.id));           // remove service from bots array on disconnect
            } else {                                                          // in case token was wrong or name not provided
                console.log('Rejected socket connection: ' + client.id);
                client.on('disconnect', function(){
                    console.log('Rejected socket disconnected: ' + client.id);
                });
            }
        };
    },
    authEmit: function(evnt, data){                      // we only want to emit to services authorized to recieve data
        for(var i = 0; i < bot.s.length; i++){           // for all connected services
            socket.io.to(bot.s[i].id).emit(evnt, data);  // emit data for x event to indivdual socket in our array of services
        }
    }
};

var payment = {
    eventHandler: function(reciept){                                   // handels all payments sorting them into different types
        var ourRecord = payment.simplify(reciept);
        socket.authEmit('payment', ourRecord);
        slack.send( '$'+ reciept.mc_gross + ' pament for '+ reciept.item_name +
                    ' from '+ reciept.first_name +' '+ reciept.last_name +
                    ' ~ email:' + reciept.payer_email + ' <-contact them for card access if they are new'
        );
    },
    simplify: function(reciept){
        var ourRecord = {  // standard information and default settings
            product: reciept.item_name + ' ' + reciept.item_number,
            firstname: reciept.first_name,
            lastname: reciept.last_name,
            amount: reciept.mc_gross,
            currancy: reciept.mc_currency,
            payment_date: reciept.payment_date,
            payer_email: reciept.payer_email,
            address: 'Not Provided',
            txn_id: reciept.txn_id,            // use for varify against double paying
            txn_type: reciept.txn_type,        // will show
            test: false
        };
        // varify inconsistent information below
        if(reciept.address_city && reciept.address_street){ // given there is at least a city and street address
            ourRecord.address = reciept.address_fullname + ' ' + reciept.address_city + ' ' + reciept.address_city + ' ' +
            reciept.address_state + ' ' + reciept.address_zip + ' ' + reciept.address_country_code;
        }
        if(!reciept.item_name){ourRecord.product = reciept.item_name1 + ' ' + reciept.item_number;}
        if(reciept.test_ipn === 1){ourRecord.test = true;}
        if(!reciept.payment_date){ourRecord.payment_date = new Date().toUTCString();} // We should always have a payment time
        return ourRecord; // return simplified payment object that will be stored in our database
    }
};

var paypal = {
    request: require('request'),
    querystring: require('querystring'),
    options: function (postreq, responseURI){
        return {
            uri: responseURI, method: 'POST', headers:{'Connection': 'close'},
            body: postreq, strictSSL: true, rejectUnauhtorized: false,
            requestCert: true, agent: false
        };
    },
    listenEvent: function(responseURI){                                    // create route handler for test or prod
        return function(req, res){                                         // route handler
            if(req.body){                                                  // verify payment is comming from a payment to our email
                res.status(200).send('OK');                                // ACK notification
                res.end();                                                 // end response
                if(req.body.receiver_email === process.env.PAYPAL_EMAIL){  // make sure we are meant to recieve this payment
                    var postreq = 'cmd=_notify-validate';    // read ipn message and prepend with _notify-validate and post back to paypal
                    for(var key in req.body){                // not quite sure that this is right its from an example
                        if(req.body.hasOwnProperty(key)){    // for all keys
                            postreq = postreq + '&' + key + '=' + paypal.querystring.escape(req.body[key]); // build new post body
                        }
                    }    // Prove they sent what they think they sent you, post it back to them
                    paypal.request(paypal.options(postreq, responseURI), paypal.requestResponse(req.body));
                } else { // log any funny business
                    console.log('reciever email:' + req.body.receiver_email + ' is not equel to ' + process.env.PAYPAL_EMAIL);
                }
            }
        };
    },
    requestResponse: function(oBody){
        return function(error, response, body){
            console.log('original request body:'+ JSON.stringify(oBody));
            if(error){slack.send('IPN response issue:' + error);}
            else if(response.statusCode === 200){
                if(body.substring(0, 8) === 'VERIFIED'){
                    // send oBody.txn_id to note transaction number, if number is same as an old one its invalid
                    if(oBody.payment_status === 'Completed'){ // varify that this is a completed payment
                        payment.eventHandler(oBody);          // pass original body to payment handler when we have verified a valid payment
                    }                                         // send to renewal channel who just paid!
                } else if (body.substring(0, 7) === 'INVALID') {
                    slack.send('Invalid IPN POST');     // IPN invalid, log for manual investigation
                }
            } else {slack.send('IPN post, other code: ' + response.statusCode);}
        };
    }
};

var serve = {                                                // depends on cookie, routes, handles express server setup
    express: require('express'),                             // server framework library
    parse: require('body-parser'),                           // middleware to parse JSON bodies
    theSite: function (){                                    // methode call to serve site
        var app = serve.express();                           // create famework object
        var http = require('http').Server(app);              // http server for express frameworkauth)
        app.use(serve.parse.urlencoded({extended: true}));   // support URL-encoded bodies
        app.use(serve.express.static(__dirname + '/views')); // serve page dependancies (socket, jquery, bootstrap)
        var router = serve.express.Router();                 // create express router object to add routing events to
        router.get('/', function(req, res){res.send(bot.listEm());});                               // list connected bots
        router.post('/ipnlistener', paypal.listenEvent('https://www.paypal.com/cgi-bin/webscr'));   // real listener post route
        router.post('/sand', paypal.listenEvent('https://www.sandbox.paypal.com/cgi-bin/webscr'));  // test with paypal's IPN simulator
        router.post('/test', paypal.listenEvent('http://localhost:8378/test'));                     // test w/ a local IPN simulator
        app.use(router);                                     // get express to user the routes we set
        return http;
    }
};

slack.init();                                                // intilize slack bot to talk to x channel, with what channel it might use
var http = serve.theSite();                                  // set express middleware and routes up
socket.listen(http);                                         // listen and handle socket connections
http.listen(process.env.PORT);                               // listen on specified PORT enviornment variable
