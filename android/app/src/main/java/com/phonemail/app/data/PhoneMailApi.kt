package com.phonemail.app.data

import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

interface PhoneMailApi {
    @GET("api/config") suspend fun config(): AppConfig

    @POST("api/auth/otp/request") suspend fun requestOtp(@Body body: OtpRequest): OtpRequestResponse
    @POST("api/auth/otp/verify") suspend fun verifyOtp(@Body body: OtpVerifyRequest): VerifyResponse
    @POST("api/auth/logout") suspend fun logout(): OkResponse

    @GET("api/me") suspend fun me(): Me
    @PATCH("api/me") suspend fun updateMe(@Body body: ProfilePatch): Me
    @Multipart @PUT("api/me/avatar") suspend fun uploadAvatar(@Part file: MultipartBody.Part): Me
    @DELETE("api/me/avatar") suspend fun removeAvatar(): Me
    @HTTP(method = "DELETE", path = "api/me", hasBody = true) suspend fun deleteAccount(@Body body: DeleteAccountRequest): OkResponse
    @POST("api/me/aliases") suspend fun addAlias(@Body body: AliasRequest): AliasResponse
    @DELETE("api/me/aliases/{address}") suspend fun removeAlias(@Path("address") address: String): OkResponse
    @GET("api/me/sessions") suspend fun sessions(): Items<SessionInfo>
    @DELETE("api/me/sessions/{id}") suspend fun revokeSession(@Path("id") id: String): OkResponse

    @GET("api/conversations") suspend fun conversations(
        @Query("filter") filter: String,
        @Query("q") q: String? = null,
        @Query("limit") limit: Int = 200,
    ): Items<Conversation>
    @POST("api/conversations/open") suspend fun openConversation(@Body body: OpenConversationRequest): Conversation
    @GET("api/conversations/{id}") suspend fun conversation(@Path("id") id: String): Conversation
    @GET("api/conversations/{id}/messages") suspend fun conversationMessages(
        @Path("id") id: String,
        @Query("before") before: String? = null,
        @Query("limit") limit: Int = 50,
    ): MessagePage
    @POST("api/conversations/{id}/messages") suspend fun sendInConversation(@Path("id") id: String, @Body body: SendChatRequest): SendResponse
    @POST("api/conversations/{id}/read") suspend fun markConversationRead(@Path("id") id: String, @Body body: ReadRequest): Map<String, Int>
    @PATCH("api/conversations/{id}") suspend fun setFavorite(@Path("id") id: String, @Body body: FavoriteRequest): Conversation
    @DELETE("api/conversations/{id}") suspend fun trashConversation(@Path("id") id: String): Map<String, Int>
    @POST("api/conversations/{id}/spam") suspend fun reportSpam(@Path("id") id: String): Map<String, Int>
    @GET("api/conversations/{id}/draft") suspend fun chatDraft(@Path("id") id: String): ChatDraftResponse
    @PUT("api/conversations/{id}/draft") suspend fun saveChatDraft(@Path("id") id: String, @Body body: ChatDraftRequest): ChatDraftResponse

    @GET("api/messages") suspend fun messages(
        @Query("folder") folder: String,
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0,
    ): FolderPage
    @GET("api/messages/counts") suspend fun counts(): Counts
    @GET("api/messages/{id}") suspend fun message(@Path("id") id: String): Message
    @POST("api/messages") suspend fun send(@Body body: ComposeRequest): SendResponse
    @PATCH("api/messages/{id}") suspend fun setFlags(@Path("id") id: String, @Body body: FlagsRequest): Message
    @POST("api/messages/batch") suspend fun batch(@Body body: BatchRequest): Map<String, Int>
    @POST("api/folders/{folder}/empty") suspend fun emptyFolder(@Path("folder") folder: String): Map<String, Int>
    @GET("api/sync/notifications") suspend fun syncNotifications(@Query("since") since: String?): SyncResponse

    @GET("api/drafts") suspend fun drafts(): Items<Draft>
    @GET("api/drafts/{id}") suspend fun draft(@Path("id") id: String): Draft
    @POST("api/drafts") suspend fun createDraft(@Body body: DraftRequest): Draft
    @PUT("api/drafts/{id}") suspend fun updateDraft(@Path("id") id: String, @Body body: DraftRequest): Draft
    @DELETE("api/drafts/{id}") suspend fun deleteDraft(@Path("id") id: String): OkResponse

    @Multipart @POST("api/attachments") suspend fun upload(@Part file: MultipartBody.Part): UploadResponse

    @GET("api/lookup") suspend fun lookup(@Query("q") q: String): LookupResult
    @POST("api/contacts/match") suspend fun matchContacts(@Body body: ContactsMatchRequest): Items<ContactMatch>
}
