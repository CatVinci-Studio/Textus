#import <Foundation/Foundation.h>
#import <Speech/Speech.h>
#import <AVFoundation/AVFoundation.h>
#include <math.h>
#include <stdatomic.h>
typedef void (*TextusCallback)(uint64_t, int, const char *);
static _Atomic(uint64_t) current = 0;
static TextusCallback callback;
static AVAudioEngine *engine;
static SFSpeechAudioBufferRecognitionRequest *request;
static SFSpeechRecognitionTask *task;
static SFSpeechRecognizer *recognizer;
static NSTimer *timer;
static NSString *transcript;
static NSTimeInterval started, lastVoice;
static BOOL heard, installed;
static void finish(uint64_t token, NSString *error) {
    if (current != token) return;
    current = 0;
    [timer invalidate]; timer=nil;
    [engine stop];
    if (installed) [engine.inputNode removeTapOnBus:0];
    installed=NO;
    [request endAudio]; [task cancel];
    task=nil; request=nil; engine=nil; recognizer=nil;
    callback(token,error ? 2 : 1,(error ?: transcript ?: @"").UTF8String);
}
static void record(uint64_t token, NSString *locale) {
    if(current!=token)return;
    recognizer=[[SFSpeechRecognizer alloc] initWithLocale:[NSLocale localeWithLocaleIdentifier:locale]];
    if(!recognizer || !recognizer.available) {finish(token,@"Speech recognition is unavailable for this language. Choose MiniMax or enable the language in macOS settings.");return;}
    request=[SFSpeechAudioBufferRecognitionRequest new];
    request.shouldReportPartialResults=YES;
    // On-device when the language model is installed; otherwise Apple's
    // recognition service rather than refusing outright.
    request.requiresOnDeviceRecognition=recognizer.supportsOnDeviceRecognition;
    if(@available(macOS 13, *)) request.addsPunctuation=YES;
    transcript=@""; heard=NO;
    started=lastVoice=NSDate.timeIntervalSinceReferenceDate;
    engine=[AVAudioEngine new];
    AVAudioInputNode *input=engine.inputNode;
    AVAudioFormat *format=[input outputFormatForBus:0];
    if(format.sampleRate<=0 || format.channelCount==0){finish(token,@"Microphone is unavailable.");return;}
    SFSpeechAudioBufferRecognitionRequest *activeRequest=request;
    [input installTapOnBus:0 bufferSize:1024 format:format block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
        (void)when;
        if(current!=token)return;
        [activeRequest appendAudioPCMBuffer:buffer];
        if(buffer.floatChannelData && buffer.frameLength) {
            float *samples=buffer.floatChannelData[0];double energy=0;
            for(AVAudioFrameCount i=0;i<buffer.frameLength;i++) energy+=samples[i]*samples[i];
            double rms=sqrt(energy/buffer.frameLength);
            if(rms>0.012) dispatch_async(dispatch_get_main_queue(),^{if(current==token){heard=YES;lastVoice=NSDate.timeIntervalSinceReferenceDate;}});
        }
    }];
    installed=YES;
    task=[recognizer recognitionTaskWithRequest:request resultHandler:^(SFSpeechRecognitionResult *result,NSError *error){
        dispatch_async(dispatch_get_main_queue(),^{
            if(current!=token)return;
            if(result) {
                NSString *next=result.bestTranscription.formattedString;
                if(![next isEqualToString:transcript]){transcript=[next copy];heard=YES;lastVoice=NSDate.timeIntervalSinceReferenceDate;callback(token,0,transcript.UTF8String);}
                if(result.final){finish(token,nil);return;}
            }
            if(error)finish(token,error.localizedDescription);
        });
    }];
    NSError *error=nil;
    [engine prepare];
    if(![engine startAndReturnError:&error]) {finish(token,error.localizedDescription ?: @"Cannot start microphone.");return;}
    timer=[NSTimer scheduledTimerWithTimeInterval:0.15 repeats:YES block:^(NSTimer *unused){
        (void)unused; NSTimeInterval now=NSDate.timeIntervalSinceReferenceDate;
        // A thinking pause mid-sentence must not end dictation.
        if(current==token && ((heard && now-lastVoice>=2.5)||(!heard && now-started>=8)||now-started>=120))finish(token,nil);
    }];
}
void textus_dictation_start(uint64_t token,const char *language,TextusCallback cb) {
    NSString *locale=[NSString stringWithUTF8String:language];
    dispatch_async(dispatch_get_main_queue(),^{
        if(current){cb(token,2,"Another dictation session is active.");return;}
        current=token;callback=cb;transcript=@"";
        [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status){
            dispatch_async(dispatch_get_main_queue(),^{
                if(current!=token)return;
                if(status!=SFSpeechRecognizerAuthorizationStatusAuthorized){finish(token,@"Speech recognition permission was denied. Enable Textus in System Settings > Privacy & Security > Speech Recognition.");return;}
                [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL allowed){
                    dispatch_async(dispatch_get_main_queue(),^{if(current==token){if(allowed)record(token,locale);else finish(token,@"Microphone permission was denied.");}});
                }];
            });
        }];
    });
}
void textus_dictation_stop(uint64_t token) { dispatch_async(dispatch_get_main_queue(),^{finish(token,nil);}); }
