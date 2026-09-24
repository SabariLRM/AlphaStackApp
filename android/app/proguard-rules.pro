# kotlinx.serialization: keep generated serializers of our DTOs.
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-keep,includedescriptorclasses class com.phonemail.app.**$$serializer { *; }
-keepclassmembers class com.phonemail.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.phonemail.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep @kotlinx.serialization.Serializable class com.phonemail.app.data.** { *; }

# Retrofit service interface (methods are called reflectively through a proxy).
-keep,allowobfuscation interface com.phonemail.app.data.PhoneMailApi
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response

# libphonenumber loads metadata from assets by name.
-keep class io.michaelrocks.libphonenumber.android.** { *; }

-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
