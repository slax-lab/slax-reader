#import <Foundation/Foundation.h>

// Supply the formal declaration needed to override NSObject's KVO category
// selector from the unchanged original Kotlin observer.
@protocol NSKeyValueObserving <NSObject>
- (void)observeValueForKeyPath:(NSString * _Nullable)keyPath
                     ofObject:(id _Nullable)object
                       change:(NSDictionary<NSKeyValueChangeKey, id> * _Nullable)change
                      context:(void * _Nullable)context;
@end

// The generated interop wrapper also registers the protocol with Objective-C.
static inline Protocol *slaxFixtureKvoProtocol(void) { return @protocol(NSKeyValueObserving); }
