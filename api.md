1.register post => http://localhost:5000/api/v1/auth/register
request :{
  "name": "david",
  "email": "david571@gmail.com",
  "phone": "+85291234563",
  "password": "Password@123"
}

response:{
    "success": true,
    "statusCode": 201,
    "message": "User registered successfully",
    "data": {
        "id": "15aa56a7-0f83-422e-a37f-87447f166b46",
        "name": "david",
        "email": "david5711@gmail.com",
        "phone": "+85291234552",
        "role": "CUSTOMER",
        "status": "ACTIVE",
        "createdAt": "2026-09-28T06:06:03.445Z",
        "updatedAt": "2026-09-28T06:06:03.445Z"
    }
}

2.login post => http://localhost:5000/api/v1/auth/login
request :
{"email":"owner@example.com",
"password":"Owner@123"} ,
response :{
    "success": true,
    "statusCode": 200,
    "message": "User logged in successfully",
    "data": {
        "user": {
            "id": "8ab8e2d0-b5d8-47cc-b451-0f18cfc39c13",
            "name": "Salon Owner",
            "email": "owner@example.com",
            "phone": null,
            "role": "BRAND_OWNER",
            "status": "ACTIVE"
        },
        "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI4YWI4ZTJkMC1iNWQ4LTQ3Y2MtYjQ1MS0wZjE4Y2ZjMzljMTMiLCJlbWFpbCI6Im93bmVyQGV4YW1wbGUuY29tIiwicm9sZSI6IkJSQU5EX09XTkVSIiwiaWF0IjoxNzkwNTg0NzE1LCJleHAiOjE3OTA2NzExMTV9.46dr-NEjYe8e3PqCPpezWdbwMVHBQwMgRD6y2KbrioQ",
        "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI4YWI4ZTJkMC1iNWQ4LTQ3Y2MtYjQ1MS0wZjE4Y2ZjMzljMTMiLCJlbWFpbCI6Im93bmVyQGV4YW1wbGUuY29tIiwicm9sZSI6IkJSQU5EX09XTkVSIiwianRpIjoiMjliNGVlYmUtMzFjZC00NTE5LWEwNjgtYjY0OWVjZDUzMWJiIiwiaWF0IjoxNzkwNTg0NzE1LCJleHAiOjE3OTExODk1MTV9.W7QKdfbRU4BDE0O4cesV_iFNB4X1N1GPEehrgosM2g8"
    }
}


3. Get Me  get => http://localhost:5000/api/v1/users/me
response :{
    "success": true,
    "statusCode": 200,
    "message": "User profile fetched successfully",
    "data": {
        "id": "8ab8e2d0-b5d8-47cc-b451-0f18cfc39c13",
        "name": "Salon Owner",
        "email": "owner@example.com",
        "phone": null,
        "role": "BRAND_OWNER",
        "status": "ACTIVE",
        "createdAt": "2026-09-20T04:46:59.404Z",
        "updatedAt": "2026-09-20T04:46:59.404Z"
    }
}

4.Refresh Token post => http://localhost:5000/api/v1/auth/refresh-token

request :{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI4YWI4ZTJkMC1iNWQ4LTQ3Y2MtYjQ1MS0wZjE4Y2ZjMzljMTMiLCJlbWFpbCI6Im93bmVyQGV4YW1wbGUuY29tIiwicm9sZSI6IkJSQU5EX09XTkVSIiwianRpIjoiMjliNGVlYmUtMzFjZC00NTE5LWEwNjgtYjY0OWVjZDUzMWJiIiwiaWF0IjoxNzkwNTg0NzE1LCJleHAiOjE3OTExODk1MTV9.W7QKdfbRU4BDE0O4cesV_iFNB4X1N1GPEehrgosM2g8"
}


response :{
    "success": true,
    "statusCode": 200,
    "message": "New tokens generated successfully",
    "data": null
}

5.logout post =>http://localhost:5000/api/v1/auth/logout

response :{
    "success": true,
    "statusCode": 200,
    "message": "Logged out successfully",
    "data": null
}

6.forgot password post =>http://localhost:5000/api/v1/auth/forgot-password

request:{
  "email": "saikatali571@gmail.com"
}
response :{
    "success": true,
    "statusCode": 200,
    "message": "Password reset OTP sent to your email",
    "data": null
}

7.verify otp post =>http://localhost:5000/api/v1/auth/verify-reset-otp

request :{
  "email": "saikatali571@gmail.com",
  "otp": "776241"
}

response :{
    "success": true,
    "statusCode": 200,
    "message": "OTP verified successfully",
    "data": {
        "resetToken": "008f5174d9deb219eb4901ecf56ca41cc01ff7489ac9e770352d48deca6e70a8",
        "expiresIn": 600
    }
}

8.reset password post =>http://localhost:5000/api/v1/auth/reset-password


request :{
  "resetToken": "008f5174d9deb219eb4901ecf56ca41cc01ff7489ac9e770352d48deca6e70a8",
  "newPassword": "NewPassword@1234"
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Password reset successfully",
    "data": null
}

9.update profile patch => http://localhost:5000/api/v1/users/me

request :{
  "name": "Saikat Updated",
  "phone": "+85298887776"
}

response :{
    "success": true,
    "statusCode": 200,
    "message": "Profile updated successfully",
    "data": {
        "id": "15fb4319-0091-430e-9126-c8ced8122c99",
        "name": "Saikat Updated",
        "email": "saikatali571@gmail.com",
        "phone": "+85298887776",
        "role": "CUSTOMER",
        "status": "ACTIVE",
        "createdAt": "2026-09-19T08:25:44.739Z",
        "updatedAt": "2026-09-28T08:55:48.767Z"
    }
}

10.change password patch =>http://localhost:5000/api/v1/users/me/password

request :{
  "currentPassword": "NewPassword@1234",
  "newPassword": "NewPassword@12345"
}

response :{
    "success": true,
    "statusCode": 200,
    "message": "Password changed successfully",
    "data": null
}

11.Get brand info get => http://localhost:5000/api/v1/brand

response : {
    "success": true,
    "statusCode": 200,
    "message": "Brand fetched successfully",
    "data": {
        "id": "b33b77e2-868f-4629-9f2e-b4de6a0bb9d3",
        "name": "ABC Hair Hong Kong",
        "description": "Professional Hair Salon and Barbershop in Hong Kong",
        "phone": "+85221234567",
        "email": "info@abchair.hk",
        "logoObjectKey": null,
        "createdAt": "2026-09-20T04:47:00.243Z",
        "updatedAt": "2026-09-20T05:02:32.739Z"
    }
}

12.update brand info patch =>http://localhost:5000/api/v1/brand

request :{
  "name": "ABC Hair Hong Kong",
  "description": "Professional Hair Salon and Barbershop in Hong Kong",
  "phone": "+85221234567",
  "email": "info@abchair.hk"
}
response :{
    "success": true,
    "statusCode": 200,
    "message": "Brand updated successfully",
    "data": {
        "id": "b33b77e2-868f-4629-9f2e-b4de6a0bb9d3",
        "name": "ABC Hair Hong Kong",
        "description": "Professional Hair Salon and Barbershop in Hong Kong",
        "phone": "+85221234567",
        "email": "info@abchair.hk",
        "logoObjectKey": null,
        "createdAt": "2026-09-20T04:47:00.243Z",
        "updatedAt": "2026-09-28T03:31:44.071Z"
    }
}

13 .Create Branch (owner) post =>http://localhost:5000/api/v1/branches

request :{
  "name": "Tsim Sha Tsui Branch",
  "address": "Nathan Road, Tsim Sha Tsui, Kowloon, Hong Kong",
  "phone": "+85223681234",
  "description": "Tsim Sha Tsui hair salon and barbershop branch"
}

response:{
    "success": true,
    "statusCode": 201,
    "message": "Branch created successfully",
    "data": {
        "id": "1833de60-a98f-483e-879f-384dbd3796c8",
        "name": "Tsim Sha Tsui Branch",
        "address": "Nathan Road, Tsim Sha Tsui, Kowloon, Hong Kong",
        "phone": "+85223681234",
        "description": "Tsim Sha Tsui hair salon and barbershop branch",
        "imageObjectKey": null,
        "status": "ACTIVE",
        "createdAt": "2026-09-28T09:05:54.965Z",
        "updatedAt": "2026-09-28T09:05:54.965Z"
    }
}

14.Get All Branch Info get =>http://localhost:5000/api/v1/branches

response :{
    "success": true,
    "statusCode": 200,
    "message": "Branches fetched successfully",
    "data": {
        "items": [
            {
                "id": "ce301969-5d02-4a50-8378-90137e0744bd",
                "name": "Mong Kok Branch",
                "address": "Mong Kok, Hong Kong",
                "phone": "+85221234567",
                "description": "Mong Kok branch",
                "imageObjectKey": null,
                "status": "ACTIVE",
                "createdAt": "2026-09-28T03:32:40.122Z",
                "updatedAt": "2026-09-28T03:32:40.122Z"
            },
            {
                "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                "name": "Mong Kok Central Branch",
                "address": "Nathan Road, Mong Kok, Hong Kong",
                "phone": "+85223456789",
                "description": "Main Mong Kok hair salon branch updated",
                "imageObjectKey": null,
                "status": "ACTIVE",
                "createdAt": "2026-09-20T05:30:38.391Z",
                "updatedAt": "2026-09-22T06:11:49.991Z"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 2,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}

15.Get Single Branch Info  get =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989


response:{
    "success": true,
    "statusCode": 200,
    "message": "Branch fetched successfully",
    "data": {
        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
        "name": "Mong Kok Central Branch",
        "address": "Nathan Road, Mong Kok, Hong Kong",
        "phone": "+85223456789",
        "description": "Main Mong Kok hair salon branch updated",
        "imageObjectKey": null,
        "status": "ACTIVE",
        "createdAt": "2026-09-20T05:30:38.391Z",
        "updatedAt": "2026-09-22T06:11:49.991Z"
    }
}


16.Update Branch Info  patch =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989

request :{
  "name": "Mong Kok Central Branch",
  "address": "Nathan Road,  Hong Kong",
  "phone": "+85223456789",
  "description": "Main Mong Kok hair salon branch"
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Branch updated successfully",
    "data": {
        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
        "name": "Mong Kok Central Branch",
        "address": "Nathan Road,  Hong Kong",
        "phone": "+85223456789",
        "description": "Main Mong Kok hair salon branch",
        "imageObjectKey": null,
        "status": "ACTIVE",
        "createdAt": "2026-09-20T05:30:38.391Z",
        "updatedAt": "2026-09-28T03:34:40.575Z"
    }
}

17.Update Branch Status (owner)  patch =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/status

request :{
  "status": "ACTIVE"
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Branch status updated successfully",
    "data": {
        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
        "name": "Mong Kok Central Branch",
        "address": "Nathan Road,  Hong Kong",
        "phone": "+85223456789",
        "description": "Main Mong Kok hair salon branch",
        "imageObjectKey": null,
        "status": "ACTIVE",
        "createdAt": "2026-09-20T05:30:38.391Z",
        "updatedAt": "2026-09-28T03:35:29.086Z"
    }
}

18.Get Branch Business Hour get =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/business-hours

response :{
    "success": true,
    "statusCode": 200,
    "message": "Business hours fetched successfully",
    "data": {
        "hours": [
            {
                "day": "MONDAY",
                "isClosed": false,
                "openTime": "10:00",
                "closeTime": "20:00"
            },
            {
                "day": "TUESDAY",
                "isClosed": true,
                "openTime": null,
                "closeTime": null
            },
            {
                "day": "WEDNESDAY",
                "isClosed": false,
                "openTime": "10:00",
                "closeTime": "20:00"
            }
        ]
    }
}

19.Put/Assign Business Hour(owner/manager) put =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/business-hours

request :{
  "hours": [
    {
      "day": "MONDAY",
      "isClosed": false,
      "openTime": "10:00",
      "closeTime": "20:00"
    },
    {
      "day": "TUESDAY",
      "isClosed": true,
      "openTime": null,
      "closeTime": null
    },
    {
      "day": "WEDNESDAY",
      "isClosed": false,
      "openTime": "10:00",
      "closeTime": "20:00"
    }
  ]
}

response :{
    "success": true,
    "statusCode": 200,
    "message": "Business hours updated successfully",
    "data": {
        "branchId": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
        "hours": [
            {
                "day": "MONDAY",
                "isClosed": false,
                "openTime": "10:00",
                "closeTime": "20:00"
            },
            {
                "day": "TUESDAY",
                "isClosed": true,
                "openTime": null,
                "closeTime": null
            },
            {
                "day": "WEDNESDAY",
                "isClosed": false,
                "openTime": "10:00",
                "closeTime": "20:00"
            }
        ]
    }
}

20.Get Branch Booking Policy  get =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/booking-policy

response :{
    "success": true,
    "statusCode": 200,
    "message": "Booking policy fetched successfully",
    "data": {
        "slotIntervalMinutes": 15,
        "minimumBookingNoticeMinutes": 60,
        "maximumAdvanceBookingDays": 45,
        "cancellationCutoffHours": 24,
        "rescheduleCutoffHours": 18,
        "reserveExpiryRule": "APPOINTMENT_TIME"
    }
}

21.Put/Assign Branch Booking Policy(owner/manager)  put =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/booking-policy


request:{
  "slotIntervalMinutes": 15,
  "minimumBookingNoticeMinutes": 60,
  "maximumAdvanceBookingDays": 45,
  "cancellationCutoffHours": 24,
  "rescheduleCutoffHours": 12,
  "reserveExpiryRule": "APPOINTMENT_TIME"
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Booking policy updated successfully",
    "data": {
        "branchId": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
    }
}

22.Create Service(owner) post =>http://localhost:5000/api/v1/services

request:{
  "name": "Hair Treatment special",
  "description": "Deep conditioning and professional hair treatment",
  "price": 350,
  "durationMinutes": 45,
  "branchIds": [
    "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
  ],
  "imageObjectKeys": [
    "services/temp/hair-treatment-1.webp"
  ]
}

response :{
    "success": true,
    "statusCode": 201,
    "message": "Service created successfully",
    "data": {
        "id": "a83875ad-8124-4724-aaa0-e3b3b0f8cc40",
        "name": "Hair Treatment special",
        "price": 350,
        "durationMinutes": 45,
        "status": "ACTIVE"
    }
}

23.Get All Services get =>http://localhost:5000/api/v1/services

response :{
    "success": true,
    "statusCode": 200,
    "message": "Services fetched successfully",
    "data": {
        "items": [
            {
                "id": "a83875ad-8124-4724-aaa0-e3b3b0f8cc40",
                "name": "Hair Treatment special",
                "description": "Deep conditioning and professional hair treatment",
                "price": 350,
                "durationMinutes": 45,
                "status": "ACTIVE",
                "primaryImageObjectKey": "services/temp/hair-treatment-1.webp",
                "branches": [
                    {
                        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                        "name": "Mong Kok Central Branch"
                    }
                ]
            },
            {
                "id": "7034dbb9-1186-4f24-b0f3-a0f7d624c66b",
                "name": "Hair Treatment",
                "description": "Deep conditioning and professional hair treatment",
                "price": 350,
                "durationMinutes": 45,
                "status": "ACTIVE",
                "primaryImageObjectKey": "services/temp/hair-treatment-1.webp",
                "branches": [
                    {
                        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                        "name": "Mong Kok Central Branch"
                    }
                ]
            },
            {
                "id": "eaf0fd30-1928-41c7-a5af-4e8d78583c9c",
                "name": "Hair Styling",
                "description": "Professional hair styling and finishing service",
                "price": 180,
                "durationMinutes": 30,
                "status": "ACTIVE",
                "primaryImageObjectKey": "services/temp/hair-styling-1.webp",
                "branches": [
                    {
                        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                        "name": "Mong Kok Central Branch"
                    }
                ]
            },
            {
                "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                "name": "Hair Wash",
                "description": "Professional shampoo and hair wash service",
                "price": 120,
                "durationMinutes": 20,
                "status": "ACTIVE",
                "primaryImageObjectKey": "services/temp/hair-wash-1.webp",
                "branches": [
                    {
                        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                        "name": "Mong Kok Central Branch"
                    }
                ]
            },
            {
                "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                "name": "Premium Men's Haircut",
                "description": "Professional men's haircut",
                "price": 280,
                "durationMinutes": 50,
                "status": "ACTIVE",
                "primaryImageObjectKey": "services/temp/haircut-1.webp",
                "branches": [
                    {
                        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                        "name": "Mong Kok Central Branch"
                    }
                ]
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 5,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}

24.Get Single Service get =>http://localhost:5000/api/v1/services/ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b

response :{
    "success": true,
    "statusCode": 200,
    "message": "Service fetched successfully",
    "data": {
        "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
        "name": "Premium Men's Haircut",
        "description": "Professional men's haircut",
        "price": 280,
        "durationMinutes": 50,
        "status": "ACTIVE",
        "images": [
            {
                "id": "9237407d-9b9f-4e4f-b793-5626f58b50aa",
                "objectKey": "services/temp/haircut-1.webp",
                "isPrimary": true,
                "sortOrder": 0
            },
            {
                "id": "0f9de5c6-8f73-494b-a5ec-d57205ecb21d",
                "objectKey": "services/temp/haircut-2.webp",
                "isPrimary": false,
                "sortOrder": 1
            }
        ],
        "branches": [
            {
                "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                "name": "Mong Kok Central Branch",
                "status": "ACTIVE"
            }
        ]
    }
}

25.Update Service (owner) patch =>http://localhost:5000/api/v1/services/ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b

request :{
  "name": "Premium Men's Haircut",
  "price": 280,
  "durationMinutes": 30
}
response :{
    "success": true,
    "statusCode": 200,
    "message": "Service updated successfully",
    "data": {
        "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
        "name": "Premium Men's Haircut",
        "price": 280,
        "durationMinutes": 30
    }
}

26.Update Service Status (owner) patch =>http://localhost:5000/api/v1/services/ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b/status

request:{
  "status": "ACTIVE"
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Service status updated successfully",
    "data": {
        "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
        "status": "ACTIVE"
    }
}


27.Put/Assign Service To Branch(owner) put =>http://localhost:5000/api/v1/services/ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b/branches

request :{
  "branchIds": [
    "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
  ]
}

response :{
    "success": true,
    "statusCode": 200,
    "message": "Service branches updated successfully",
    "data": {
        "serviceId": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
        "branchIds": [
            "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
        ]
    }
}

28.Get Services OF The Branch get =>http://localhost:5000/api/v1/services/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/services


response:{
    "success": true,
    "statusCode": 200,
    "message": "Branch services fetched successfully",
    "data": {
        "items": [
            {
                "id": "a83875ad-8124-4724-aaa0-e3b3b0f8cc40",
                "name": "Hair Treatment special",
                "price": 350,
                "durationMinutes": 45,
                "primaryImageObjectKey": "services/temp/hair-treatment-1.webp"
            },
            {
                "id": "7034dbb9-1186-4f24-b0f3-a0f7d624c66b",
                "name": "Hair Treatment",
                "price": 350,
                "durationMinutes": 45,
                "primaryImageObjectKey": "services/temp/hair-treatment-1.webp"
            },
            {
                "id": "eaf0fd30-1928-41c7-a5af-4e8d78583c9c",
                "name": "Hair Styling",
                "price": 180,
                "durationMinutes": 30,
                "primaryImageObjectKey": "services/temp/hair-styling-1.webp"
            },
            {
                "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                "name": "Hair Wash",
                "price": 120,
                "durationMinutes": 20,
                "primaryImageObjectKey": "services/temp/hair-wash-1.webp"
            },
            {
                "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                "name": "Premium Men's Haircut",
                "price": 280,
                "durationMinutes": 30,
                "primaryImageObjectKey": "services/temp/haircut-1.webp"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 5,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}

29.Create Package(owner) post =>http://localhost:5000/api/v1/packages

request :{
  "type": "GROUP_PURCHASE_PACKAGE",
  "name": "Summer Wash + Cut Deal",
  "description": "Limited promotional wash and haircut deal",
  "serviceIds": [
    "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
    "69d83891-dcd6-43d9-b593-ebcf24d4d70f"
  ],
  "regularPrice": 500,
  "packagePrice": 350,
  "durationMinutes": 75,
  "capacity": 100,
  "purchaseLimitPerCustomer": 2,
  "salesStartAt": "2026-10-01T00:00:00+08:00",
  "salesEndAt": "2026-10-31T23:59:59+08:00",
  "branchIds": [
    "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
  ],
  "imageObjectKeys": [
    "packages/temp/summer-wash-cut-1.webp"
  ],
  "listingStatus": "LISTED"
}

response :{
    "success": true,
    "statusCode": 201,
    "message": "Package created successfully",
    "data": {
        "id": "8c2e4488-e81b-4b67-babb-a94ee13850d4",
        "type": "GROUP_PURCHASE_PACKAGE",
        "capacity": 100,
        "soldQuantity": 0,
        "remainingQuantity": 100,
        "status": "ACTIVE",
        "listingStatus": "LISTED",
        "soldOut": false
    }
}

30.Get All Packages  get =>http://localhost:5000/api/v1/packages

response :{
    "success": true,
    "statusCode": 200,
    "message": "Packages fetched successfully",
    "data": {
        "items": [
            {
                "id": "8c2e4488-e81b-4b67-babb-a94ee13850d4",
                "type": "GROUP_PURCHASE_PACKAGE",
                "name": "Summer Wash + Cut Deal",
                "description": "Limited promotional wash and haircut deal",
                "regularPrice": 500,
                "packagePrice": 350,
                "durationMinutes": 75,
                "status": "ACTIVE",
                "listingStatus": "LISTED",
                "capacity": 100,
                "soldQuantity": 0,
                "remainingQuantity": 100,
                "soldOut": false,
                "primaryImageObjectKey": "packages/temp/summer-wash-cut-1.webp",
                "services": [
                    {
                        "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                        "name": "Premium Men's Haircut"
                    },
                    {
                        "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                        "name": "Hair Wash"
                    }
                ],
                "branches": [
                    {
                        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                        "name": "Mong Kok Central Branch"
                    }
                ]
            },
            {
                "id": "270106ec-de0a-4668-b4be-ca542c06987c",
                "type": "GROUP_PURCHASE_PACKAGE",
                "name": "Summer Wash + Cut Deal Plus",
                "description": "Limited promotional wash and haircut deal",
                "regularPrice": 500,
                "packagePrice": 380,
                "durationMinutes": 75,
                "status": "ACTIVE",
                "listingStatus": "LISTED",
                "capacity": 120,
                "soldQuantity": 0,
                "remainingQuantity": 120,
                "soldOut": false,
                "primaryImageObjectKey": "packages/temp/summer-wash-cut-1.webp",
                "services": [
                    {
                        "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                        "name": "Premium Men's Haircut"
                    },
                    {
                        "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                        "name": "Hair Wash"
                    }
                ],
                "branches": [
                    {
                        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                        "name": "Mong Kok Central Branch"
                    }
                ]
            },
            {
                "id": "2549faaa-18cf-4c60-9fff-60d3b621804e",
                "type": "STANDARD_SERVICE_PACKAGE",
                "name": "Wash + Cut Package",
                "description": "Hair wash and premium haircut package",
                "regularPrice": 500,
                "packagePrice": 420,
                "durationMinutes": 75,
                "status": "ACTIVE",
                "listingStatus": "LISTED",
                "capacity": null,
                "soldQuantity": 0,
                "remainingQuantity": null,
                "soldOut": false,
                "primaryImageObjectKey": "packages/temp/wash-cut-1.webp",
                "services": [
                    {
                        "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                        "name": "Premium Men's Haircut"
                    },
                    {
                        "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                        "name": "Hair Wash"
                    }
                ],
                "branches": [
                    {
                        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                        "name": "Mong Kok Central Branch"
                    }
                ]
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 3,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}

31.Get Single Package  get =>http://localhost:5000/api/v1/packages/270106ec-de0a-4668-b4be-ca542c06987c

response :{
    "success": true,
    "statusCode": 200,
    "message": "Package fetched successfully",
    "data": {
        "id": "270106ec-de0a-4668-b4be-ca542c06987c",
        "type": "GROUP_PURCHASE_PACKAGE",
        "name": "Summer Wash + Cut Deal Plus",
        "description": "Limited promotional wash and haircut deal",
        "regularPrice": 500,
        "packagePrice": 380,
        "durationMinutes": 75,
        "status": "ACTIVE",
        "listingStatus": "LISTED",
        "capacity": 120,
        "soldQuantity": 0,
        "remainingQuantity": 120,
        "purchaseLimitPerCustomer": 2,
        "salesStartAt": "2026-08-31T16:00:00.000Z",
        "salesEndAt": "2026-10-31T15:59:59.000Z",
        "soldOut": false,
        "images": [
            {
                "id": "390c5114-1f8d-41b3-af9d-367d4f864a45",
                "objectKey": "packages/temp/summer-wash-cut-1.webp",
                "isPrimary": true,
                "sortOrder": 0
            }
        ],
        "services": [
            {
                "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                "name": "Premium Men's Haircut",
                "price": 280,
                "durationMinutes": 30,
                "status": "ACTIVE"
            },
            {
                "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                "name": "Hair Wash",
                "price": 120,
                "durationMinutes": 20,
                "status": "ACTIVE"
            }
        ],
        "branches": [
            {
                "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                "name": "Mong Kok Central Branch",
                "status": "ACTIVE"
            }
        ]
    }
}

32.Update Package(owner)  patch =>http://localhost:5000/api/v1/packages/270106ec-de0a-4668-b4be-ca542c06987c

request :{
  "salesStartAt": "2026-09-01T00:00:00+08:00",
  "salesEndAt": "2026-10-31T23:59:59+08:00"
}
response :{
    "success": true,
    "statusCode": 200,
    "message": "Package updated successfully",
    "data": {
        "id": "270106ec-de0a-4668-b4be-ca542c06987c",
        "name": "Summer Wash + Cut Deal Plus",
        "packagePrice": 380,
        "capacity": 120
    }
}

33.Update Package Status(owner) patch =>http://localhost:5000/api/v1/packages/270106ec-de0a-4668-b4be-ca542c06987c/status


request:{
  "status": "ACTIVE"
}
response:{
    "success": true,
    "statusCode": 200,
    "message": "Package status updated successfully",
    "data": {
        "id": "270106ec-de0a-4668-b4be-ca542c06987c",
        "status": "ACTIVE"
    }
}

34.Update Package Listing (owner) patch =>http://localhost:5000/api/v1/packages/270106ec-de0a-4668-b4be-ca542c06987c/listing

request :{
  "listingStatus": "LISTED"
}

response :{
    "success": true,
    "statusCode": 200,
    "message": "Package listing updated successfully",
    "data": {
        "id": "270106ec-de0a-4668-b4be-ca542c06987c",
        "listingStatus": "LISTED"
    }
}


35.Put/Assign Package To Branch(owner) put =>http://localhost:5000/api/v1/packages/270106ec-de0a-4668-b4be-ca542c06987c/branches

request:{
  "branchIds": [
    "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
  ]
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Package branches updated successfully",
    "data": {
        "packageId": "270106ec-de0a-4668-b4be-ca542c06987c",
        "branchIds": [
            "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
        ]
    }
}

36.Get All Package Of The Branch get =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/packages

response :{
    "success": true,
    "statusCode": 200,
    "message": "Branch packages fetched successfully",
    "data": {
        "items": [
            {
                "id": "8c2e4488-e81b-4b67-babb-a94ee13850d4",
                "type": "GROUP_PURCHASE_PACKAGE",
                "name": "Summer Wash + Cut Deal",
                "description": "Limited promotional wash and haircut deal",
                "regularPrice": 500,
                "packagePrice": 350,
                "durationMinutes": 75,
                "primaryImageObjectKey": "packages/temp/summer-wash-cut-1.webp",
                "services": [
                    {
                        "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                        "name": "Premium Men's Haircut"
                    },
                    {
                        "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                        "name": "Hair Wash"
                    }
                ],
                "capacity": 100,
                "soldQuantity": 0,
                "remainingQuantity": 100,
                "purchaseLimitPerCustomer": 2,
                "salesStartAt": "2026-09-30T16:00:00.000Z",
                "salesEndAt": "2026-10-31T15:59:59.000Z",
                "soldOut": false,
                "purchaseAvailable": false
            },
            {
                "id": "270106ec-de0a-4668-b4be-ca542c06987c",
                "type": "GROUP_PURCHASE_PACKAGE",
                "name": "Summer Wash + Cut Deal Plus",
                "description": "Limited promotional wash and haircut deal",
                "regularPrice": 500,
                "packagePrice": 380,
                "durationMinutes": 75,
                "primaryImageObjectKey": "packages/temp/summer-wash-cut-1.webp",
                "services": [
                    {
                        "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                        "name": "Premium Men's Haircut"
                    },
                    {
                        "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                        "name": "Hair Wash"
                    }
                ],
                "capacity": 120,
                "soldQuantity": 0,
                "remainingQuantity": 120,
                "purchaseLimitPerCustomer": 2,
                "salesStartAt": "2026-08-31T16:00:00.000Z",
                "salesEndAt": "2026-10-31T15:59:59.000Z",
                "soldOut": false,
                "purchaseAvailable": true
            },
            {
                "id": "2549faaa-18cf-4c60-9fff-60d3b621804e",
                "type": "STANDARD_SERVICE_PACKAGE",
                "name": "Wash + Cut Package",
                "description": "Hair wash and premium haircut package",
                "regularPrice": 500,
                "packagePrice": 420,
                "durationMinutes": 75,
                "primaryImageObjectKey": "packages/temp/wash-cut-1.webp",
                "services": [
                    {
                        "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                        "name": "Premium Men's Haircut"
                    },
                    {
                        "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                        "name": "Hair Wash"
                    }
                ]
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 3,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}

37.Create Group Purchase post =>http://localhost:5000/api/v1/group-purchases

request:{
  "packageId": "270106ec-de0a-4668-b4be-ca542c06987c",
  "quantity": 1
}

response :{
    "success": true,
    "statusCode": 201,
    "message": "Group purchase started successfully",
    "data": {
        "purchaseId": "15d2a2cc-07de-4fc9-91e8-c12d3b95dafd",
        "packageId": "270106ec-de0a-4668-b4be-ca542c06987c",
        "quantity": 1,
        "unitPrice": 380,
        "amount": 380,
        "paymentStatus": "PENDING"
    }
}

38.Get My All Purchase  get =>http://localhost:5000/api/v1/group-purchases/my?page=1&limit=20

response :{
    "success": true,
    "statusCode": 200,
    "message": "Group purchases fetched successfully",
    "data": {
        "items": [
            {
                "id": "15d2a2cc-07de-4fc9-91e8-c12d3b95dafd",
                "package": {
                    "id": "270106ec-de0a-4668-b4be-ca542c06987c",
                    "name": "Summer Wash + Cut Deal Plus",
                    "type": "GROUP_PURCHASE_PACKAGE",
                    "primaryImageObjectKey": "packages/temp/summer-wash-cut-1.webp"
                },
                "quantity": 1,
                "unitPrice": 380,
                "amount": 380,
                "paymentStatus": "PENDING",
                "reservationExpiresAt": "2026-09-28T04:07:11.900Z",
                "purchasedAt": null,
                "createdAt": "2026-09-28T03:52:13.596Z"
            },
            {
                "id": "d140e1a7-8a6d-4bff-b7ed-eaa76049f6dd",
                "package": {
                    "id": "270106ec-de0a-4668-b4be-ca542c06987c",
                    "name": "Summer Wash + Cut Deal Plus",
                    "type": "GROUP_PURCHASE_PACKAGE",
                    "primaryImageObjectKey": "packages/temp/summer-wash-cut-1.webp"
                },
                "quantity": 1,
                "unitPrice": 380,
                "amount": 380,
                "paymentStatus": "FAILED",
                "reservationExpiresAt": "2026-09-21T05:49:40.460Z",
                "purchasedAt": null,
                "createdAt": "2026-09-21T05:34:41.392Z"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 2,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}

39. Get My Single Purchase get =>http://localhost:5000/api/v1/group-purchases/d140e1a7-8a6d-4bff-b7ed-eaa76049f6dd

response :{
    "success": true,
    "statusCode": 200,
    "message": "Group purchase fetched successfully",
    "data": {
        "id": "d140e1a7-8a6d-4bff-b7ed-eaa76049f6dd",
        "package": {
            "id": "270106ec-de0a-4668-b4be-ca542c06987c",
            "name": "Summer Wash + Cut Deal Plus",
            "type": "GROUP_PURCHASE_PACKAGE",
            "regularPrice": 500,
            "packagePrice": 380,
            "durationMinutes": 75,
            "primaryImageObjectKey": "packages/temp/summer-wash-cut-1.webp",
            "images": [
                {
                    "objectKey": "packages/temp/summer-wash-cut-1.webp",
                    "isPrimary": true,
                    "sortOrder": 0
                }
            ],
            "services": [
                {
                    "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                    "name": "Premium Men's Haircut"
                },
                {
                    "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                    "name": "Hair Wash"
                }
            ],
            "branches": [
                {
                    "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                    "name": "Mong Kok Central Branch"
                }
            ]
        },
        "quantity": 1,
        "unitPrice": 380,
        "amount": 380,
        "paymentStatus": "FAILED",
        "reservationExpiresAt": "2026-09-21T05:49:40.460Z",
        "purchasedAt": null,
        "createdAt": "2026-09-21T05:34:41.392Z"
    }
}

40.Create Staff(owner) post =>http://localhost:5000/api/v1/staff

request :{
  "name": "Saikat",
  "email": "saikatali5711@gmail.com",
  "phone": "+85291234560",
  "roleTitle": "Senior Barber",
  "specialization": "Men's Haircut & Styling",
  "description": "Senior barber specializing in men's grooming.",
  "branchIds": [
    "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
  ],
  "serviceIds": [
    "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
    "69d83891-dcd6-43d9-b593-ebcf24d4d70f"
  ],
  "packageIds": [
    "2549faaa-18cf-4c60-9fff-60d3b621804e"
  ],
  "avatarObjectKey": "staff/temp/alex-wong.webp"
}

response :{
    "success": true,
    "statusCode": 201,
    "message": "Staff created successfully",
    "data": {
        "id": "da326fb7-9149-480c-b965-d88a556945ba",
        "name": "Saikat",
        "email": "saikatali5711@gmail.com",
        "branchIds": [
            "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
        ],
        "serviceIds": [
            "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
            "69d83891-dcd6-43d9-b593-ebcf24d4d70f"
        ],
        "packageIds": [
            "2549faaa-18cf-4c60-9fff-60d3b621804e"
        ],
        "status": "ACTIVE",
        "temporaryPassword": "BqFqj6@Q2on*x@vA",
        "mustChangePassword": true
    }
}

41.Get All Staff  get =>http://localhost:5000/api/v1/staff?branchId=a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989

response :{
    "success": true,
    "statusCode": 200,
    "message": "Staff fetched successfully",
    "data": {
        "items": [
            {
                "id": "da326fb7-9149-480c-b965-d88a556945ba",
                "name": "Saikat",
                "email": "saikatali5711@gmail.com",
                "phone": "+85291234560",
                "roleTitle": "Senior Barber",
                "specialization": "Men's Haircut & Styling",
                "description": "Senior barber specializing in men's grooming.",
                "avatarObjectKey": "staff/temp/alex-wong.webp",
                "status": "ACTIVE",
                "branches": [
                    {
                        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                        "name": "Mong Kok Central Branch"
                    }
                ],
                "services": [
                    {
                        "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                        "name": "Premium Men's Haircut"
                    },
                    {
                        "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                        "name": "Hair Wash"
                    }
                ],
                "packages": [
                    {
                        "id": "2549faaa-18cf-4c60-9fff-60d3b621804e",
                        "name": "Wash + Cut Package",
                        "type": "STANDARD_SERVICE_PACKAGE"
                    }
                ]
            },
            {
                "id": "d11ecf89-7c6c-4ac9-a164-248df9636d04",
                "name": "James Wong",
                "email": "james.wong@salon.hk",
                "phone": "+85291234565",
                "roleTitle": "Senior Barber",
                "specialization": "Men's Haircut & Styling",
                "description": "Senior barber specializing in men's grooming.",
                "avatarObjectKey": "staff/temp/alex-wong.webp",
                "status": "ACTIVE",
                "branches": [
                    {
                        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                        "name": "Mong Kok Central Branch"
                    }
                ],
                "services": [
                    {
                        "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                        "name": "Premium Men's Haircut"
                    },
                    {
                        "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                        "name": "Hair Wash"
                    }
                ],
                "packages": [
                    {
                        "id": "2549faaa-18cf-4c60-9fff-60d3b621804e",
                        "name": "Wash + Cut Package",
                        "type": "STANDARD_SERVICE_PACKAGE"
                    }
                ]
            },
            {
                "id": "f734927d-38d6-484a-a895-3c59465ed023",
                "name": "Alex Wong",
                "email": "alex.wong@salon.hk",
                "phone": "+85291234569",
                "roleTitle": "Lead Barber",
                "specialization": "Men's Haircut, Styling & Grooming",
                "description": "Lead barber specializing in premium men's grooming.",
                "avatarObjectKey": "staff/temp/alex-wong.webp",
                "status": "ACTIVE",
                "branches": [
                    {
                        "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                        "name": "Mong Kok Central Branch"
                    }
                ],
                "services": [
                    {
                        "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                        "name": "Premium Men's Haircut"
                    },
                    {
                        "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                        "name": "Hair Wash"
                    }
                ],
                "packages": [
                    {
                        "id": "2549faaa-18cf-4c60-9fff-60d3b621804e",
                        "name": "Wash + Cut Package",
                        "type": "STANDARD_SERVICE_PACKAGE"
                    }
                ]
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 3,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}

42.Get Single Staff Info get =>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023

response :{
    "success": true,
    "statusCode": 200,
    "message": "Staff fetched successfully",
    "data": {
        "id": "f734927d-38d6-484a-a895-3c59465ed023",
        "name": "Alex Wong",
        "email": "alex.wong@salon.hk",
        "phone": "+85291234569",
        "roleTitle": "Lead Barber",
        "specialization": "Men's Haircut, Styling & Grooming",
        "description": "Lead barber specializing in premium men's grooming.",
        "avatarObjectKey": "staff/temp/alex-wong.webp",
        "status": "ACTIVE",
        "branches": [
            {
                "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                "name": "Mong Kok Central Branch",
                "status": "ACTIVE"
            }
        ],
        "services": [
            {
                "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                "name": "Premium Men's Haircut",
                "price": 280,
                "durationMinutes": 30,
                "status": "ACTIVE"
            },
            {
                "id": "69d83891-dcd6-43d9-b593-ebcf24d4d70f",
                "name": "Hair Wash",
                "price": 120,
                "durationMinutes": 20,
                "status": "ACTIVE"
            }
        ],
        "packages": [
            {
                "id": "2549faaa-18cf-4c60-9fff-60d3b621804e",
                "name": "Wash + Cut Package",
                "type": "STANDARD_SERVICE_PACKAGE",
                "packagePrice": 420,
                "durationMinutes": 75,
                "status": "ACTIVE",
                "listingStatus": "LISTED"
            }
        ],
        "createdAt": "2026-09-21T07:12:20.770Z",
        "updatedAt": "2026-09-21T08:06:48.098Z"
    }
}

43.Update Staff Info(owner) patch =>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023

request :{
  "roleTitle": "Leads Barber",
  "specialization": "Men's Haircut, Styling & Grooming",
  "description": "Lead barber specializing in premium men's grooming."
}

response :{
    "success": true,
    "statusCode": 200,
    "message": "Staff updated successfully",
    "data": {
        "id": "f734927d-38d6-484a-a895-3c59465ed023",
        "name": "Alex Wong",
        "phone": "+85291234569",
        "roleTitle": "Leads Barber",
        "specialization": "Men's Haircut, Styling & Grooming",
        "description": "Lead barber specializing in premium men's grooming.",
        "avatarObjectKey": "staff/temp/alex-wong.webp",
        "status": "ACTIVE"
    }
}

44.Update Staff Status(owner) patch =>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023/status

request :{
  "status": "ACTIVE"
}
response:{
    "success": true,
    "statusCode": 200,
    "message": "Staff status updated successfully",
    "data": {
        "id": "f734927d-38d6-484a-a895-3c59465ed023",
        "status": "ACTIVE"
    }
}

45.Put/Assign Staff To Branches(owner)  put =>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023/branches


request:{
  "branchIds": [
    "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
  ]
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Staff branches updated successfully",
    "data": {
        "staffId": "f734927d-38d6-484a-a895-3c59465ed023",
        "branchIds": [
            "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
        ]
    }
}

46.Put/Assign Staff To Service (owner) put=>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023/services

request:{
  "serviceIds": [
    "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
    "69d83891-dcd6-43d9-b593-ebcf24d4d70f"
  ]
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Staff services updated successfully",
    "data": {
        "staffId": "f734927d-38d6-484a-a895-3c59465ed023",
        "serviceIds": [
            "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
            "69d83891-dcd6-43d9-b593-ebcf24d4d70f"
        ]
    }
}

47.Put /Assign Staff To Package(owner) put =>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023/packages

request:{
  "packageIds": [
    "2549faaa-18cf-4c60-9fff-60d3b621804e"
  ]
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Staff packages updated successfully",
    "data": {
        "staffId": "f734927d-38d6-484a-a895-3c59465ed023",
        "packageIds": [
            "2549faaa-18cf-4c60-9fff-60d3b621804e"
        ]
    }
}

48.Get Staff Of The Branch get =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/staff

response:{
    "success": true,
    "statusCode": 200,
    "message": "Branch staff fetched successfully",
    "data": {
        "items": [
            {
                "id": "f734927d-38d6-484a-a895-3c59465ed023",
                "name": "Alex Wong",
                "roleTitle": "Leads Barber",
                "specialization": "Men's Haircut, Styling & Grooming",
                "avatarObjectKey": "staff/temp/alex-wong.webp"
            },
            {
                "id": "d11ecf89-7c6c-4ac9-a164-248df9636d04",
                "name": "James Wong",
                "roleTitle": "Senior Barber",
                "specialization": "Men's Haircut & Styling",
                "avatarObjectKey": "staff/temp/alex-wong.webp"
            },
            {
                "id": "da326fb7-9149-480c-b965-d88a556945ba",
                "name": "Saikat",
                "roleTitle": "Senior Barber",
                "specialization": "Men's Haircut & Styling",
                "avatarObjectKey": "staff/temp/alex-wong.webp"
            }
        ]
    }
}

49.Get Eligible Staff Of The Branch of the service  get =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/services/ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b/staff

response:{
    "success": true,
    "statusCode": 200,
    "message": "Eligible staff fetched successfully",
    "data": {
        "items": [
            {
                "id": "f734927d-38d6-484a-a895-3c59465ed023",
                "name": "Alex Wong",
                "roleTitle": "Leads Barber",
                "specialization": "Men's Haircut, Styling & Grooming",
                "avatarObjectKey": "staff/temp/alex-wong.webp"
            },
            {
                "id": "d11ecf89-7c6c-4ac9-a164-248df9636d04",
                "name": "James Wong",
                "roleTitle": "Senior Barber",
                "specialization": "Men's Haircut & Styling",
                "avatarObjectKey": "staff/temp/alex-wong.webp"
            },
            {
                "id": "da326fb7-9149-480c-b965-d88a556945ba",
                "name": "Saikat",
                "roleTitle": "Senior Barber",
                "specialization": "Men's Haircut & Styling",
                "avatarObjectKey": "staff/temp/alex-wong.webp"
            }
        ]
    }
}

50.Get Eligible Staff Of The Branch of The  Package  get =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/packages/2549faaa-18cf-4c60-9fff-60d3b621804e/staff

response :{
    "success": true,
    "statusCode": 200,
    "message": "Eligible staff for package fetched successfully",
    "data": {
        "items": [
            {
                "id": "f734927d-38d6-484a-a895-3c59465ed023",
                "name": "Alex Wong",
                "roleTitle": "Leads Barber",
                "specialization": "Men's Haircut, Styling & Grooming",
                "avatarObjectKey": "staff/temp/alex-wong.webp"
            },
            {
                "id": "d11ecf89-7c6c-4ac9-a164-248df9636d04",
                "name": "James Wong",
                "roleTitle": "Senior Barber",
                "specialization": "Men's Haircut & Styling",
                "avatarObjectKey": "staff/temp/alex-wong.webp"
            },
            {
                "id": "da326fb7-9149-480c-b965-d88a556945ba",
                "name": "Saikat",
                "roleTitle": "Senior Barber",
                "specialization": "Men's Haircut & Styling",
                "avatarObjectKey": "staff/temp/alex-wong.webp"
            }
        ]
    }
}

51.Put/Assign Staff Schedule(owner/manager) put =>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023/schedule

request:{
  "schedule": [
    {
      "day": "MONDAY",
      "branchId": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
      "startTime": "10:00",
      "endTime": "18:00"
    }
  ]
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Schedule updated successfully",
    "data": {
        "staffId": "f734927d-38d6-484a-a895-3c59465ed023"
    }
}

52.Get Staff Schedule  get =>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023/schedule


response:{
    "success": true,
    "statusCode": 200,
    "message": "Staff schedule fetched successfully",
    "data": {
        "staffId": "f734927d-38d6-484a-a895-3c59465ed023",
        "schedule": [
            {
                "day": "MONDAY",
                "branch": {
                    "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                    "name": "Mong Kok Central Branch"
                },
                "branchId": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                "startTime": "10:00",
                "endTime": "18:00"
            }
        ]
    }
}

52.Create Staff Unavailability(owner/manager)  post =>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023/unavailability

request:{
  "type": "BREAK",
  "date": "2026-09-28",
  "startTime": "12:00",
  "endTime": "13:00",
  "reason": "Lunch"
}

response:{
    "success": true,
    "statusCode": 201,
    "message": "Staff unavailability created successfully",
    "data": {
        "id": "3517d2a6-2671-494f-b9dc-a7eb4712ff53",
        "type": "BREAK",
        "date": "2026-09-28",
        "startTime": "12:00",
        "endTime": "13:00",
        "reason": "Lunch"
    }
}

53.Get Staff Unavailability  get =>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023/unavailability?from=2026-09-01&to=2026-09-30


response:{
    "success": true,
    "statusCode": 200,
    "message": "Staff unavailability fetched successfully",
    "data": {
        "items": [
            {
                "id": "2c0448d2-fe84-49f2-b5fe-9dad654119bd",
                "type": "BREAK",
                "date": "2026-09-28",
                "startTime": "13:00",
                "endTime": "14:00",
                "reason": "Lunch",
                "createdAt": "2026-09-22T05:51:59.287Z",
                "updatedAt": "2026-09-22T05:51:59.287Z"
            }
        ]
    }
}

54.Update Staff Unavailability (owner/manager) patch =>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023/unavailability/3517d2a6-2671-494f-b9dc-a7eb4712ff53



request:{
  "startTime": "12:00",
  "endTime": "13:00",
  "reason": "Late lunch"
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Staff unavailability updated successfully",
    "data": {
        "id": "3517d2a6-2671-494f-b9dc-a7eb4712ff53",
        "type": "BREAK",
        "date": "2026-09-28",
        "startTime": "12:00",
        "endTime": "13:00",
        "reason": "Late lunch"
    }
}

55.Delete Staff Unavailability (owner/manager)  delete =>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023/unavailability/3517d2a6-2671-494f-b9dc-a7eb4712ff53

response:{
    "success": true,
    "statusCode": 200,
    "message": "Unavailability removed successfully",
    "data": null
}


56.Get My Schedule (Staff) get =>http://localhost:5000/api/v1/staff/me/schedule

response:{
    "success": true,
    "statusCode": 200,
    "message": "My staff schedule fetched successfully",
    "data": {
        "staffId": "f734927d-38d6-484a-a895-3c59465ed023",
        "schedule": [
            {
                "day": "MONDAY",
                "branch": {
                    "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                    "name": "Mong Kok Central Branch"
                },
                "branchId": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                "startTime": "10:00",
                "endTime": "18:00"
            }
        ]
    }
}

57.Get Availability get =>http://localhost:5000/api/v1/availability?branchId=a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989&serviceId=ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b&staffId=f734927d-38d6-484a-a895-3c59465ed023&date=2026-09-28


response:{
    "success": true,
    "statusCode": 200,
    "message": "Availability retrieved successfully",
    "data": {
        "date": "2026-09-28",
        "slots": [
            {
                "startTime": "16:00",
                "endTime": "16:30",
                "staffId": "f734927d-38d6-484a-a895-3c59465ed023",
                "available": true
            },
            {
                "startTime": "16:15",
                "endTime": "16:45",
                "staffId": "f734927d-38d6-484a-a895-3c59465ed023",
                "available": true
            },
            {
                "startTime": "16:30",
                "endTime": "17:00",
                "staffId": "f734927d-38d6-484a-a895-3c59465ed023",
                "available": true
            }
        ]
    }
}

58.Pay Now Appointment create  post =>http://localhost:5000/api/v1/appointments/pay-now

request:{
  "branchId": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
  "serviceId": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
  "packageId": null,
  "staffId": "f734927d-38d6-484a-a895-3c59465ed023",
  "date": "2026-09-28",
  "startTime": "16:00"
}

response:{
    "success": true,
    "statusCode": 201,
    "message": "Pay now appointment created successfully",
    "data": {
        "appointmentId": "ad048c12-2731-4d09-bb81-eb6598843260",
        "bookingMethod": "PAY_NOW",
        "appointmentStatus": "PENDING_PAYMENT",
        "paymentStatus": "PENDING",
        "holdExpiresAt": "2026-09-28T04:54:56.112Z",
        "qrAvailable": false
    }
}

59.Create Reservation post =>http://localhost:5000/api/v1/appointments/reserve

request:{
  "branchId": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
  "serviceId": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
  "packageId": null,
  "staffId": "f734927d-38d6-484a-a895-3c59465ed023",
  "date": "2026-09-28",
  "startTime": "16:00"
}

response:{
    "success": true,
    "statusCode": 201,
    "message": "Reservation created successfully",
    "data": {
        "appointmentId": "187df81f-87d7-4ba8-b905-213be44ed80c",
        "bookingMethod": "RESERVE_NOW",
        "appointmentStatus": "RESERVED",
        "paymentStatus": "UNPAID",
        "qr": {
            "available": true,
            "token": "d07acdaaba1ae4e284e4bb271585ee935375bced835aafa6e1958b58b5b96871"
        }
    }
}

60.Get My Appointment  get =>http://localhost:5000/api/v1/appointments/my?type=UPCOMING&page=1&limit=20


response:{
    "success": true,
    "statusCode": 200,
    "message": "Appointments fetched successfully",
    "data": {
        "items": [
           
            {
                "id": "1c59d810-feb3-42cf-a59a-7c4783468d37",
                "bookingMethod": "PAY_NOW",
                "appointmentStatus": "PENDING_PAYMENT",
                "paymentStatus": "PENDING",
                "branch": {
                    "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                    "name": "Mong Kok Central Branch"
                },
                "service": {
                    "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                    "name": "Premium Men's Haircut"
                },
                "staff": {
                    "id": "f734927d-38d6-484a-a895-3c59465ed023",
                    "name": "Alex Wong"
                },
                "date": "2026-09-28",
                "startTime": "16:00",
                "endTime": "16:50",
                "price": 280,
                "qrAvailable": false
            },
            {
                "id": "b9d18c4c-9827-4740-9bd8-4ba038969f4b",
                "bookingMethod": "PAY_NOW",
                "appointmentStatus": "PENDING_PAYMENT",
                "paymentStatus": "PENDING",
                "branch": {
                    "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                    "name": "Mong Kok Central Branch"
                },
                "service": {
                    "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                    "name": "Premium Men's Haircut"
                },
                "staff": {
                    "id": "f734927d-38d6-484a-a895-3c59465ed023",
                    "name": "Alex Wong"
                },
                "date": "2026-09-28",
                "startTime": "16:00",
                "endTime": "16:50",
                "price": 280,
                "qrAvailable": false
            },
            {
                "id": "4867de09-a09f-4e99-8adc-3e8911e0bb5d",
                "bookingMethod": "PAY_NOW",
                "appointmentStatus": "PENDING_PAYMENT",
                "paymentStatus": "PENDING",
                "branch": {
                    "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                    "name": "Mong Kok Central Branch"
                },
                "service": {
                    "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                    "name": "Premium Men's Haircut"
                },
                "staff": {
                    "id": "f734927d-38d6-484a-a895-3c59465ed023",
                    "name": "Alex Wong"
                },
                "date": "2026-09-28",
                "startTime": "16:00",
                "endTime": "16:30",
                "price": 280,
                "qrAvailable": false
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 7,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}

61.Get Single Appointment Details  get =>http://localhost:5000/api/v1/appointments/3c29cc67-d6a3-48cc-b290-700bb8921f5a

response:{
    "success": true,
    "statusCode": 200,
    "message": "Appointment fetched successfully",
    "data": {
        "id": "3c29cc67-d6a3-48cc-b290-700bb8921f5a",
        "bookingMethod": "PAY_NOW",
        "appointmentStatus": "CONFIRMED",
        "paymentStatus": "PAID",
        "branch": {
            "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
            "name": "Mong Kok Central Branch"
        },
        "service": {
            "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
            "name": "Premium Men's Haircut",
            "durationMinutes": 50
        },
        "package": null,
        "staff": {
            "id": "f734927d-38d6-484a-a895-3c59465ed023",
            "name": "Alex Wong"
        },
        "date": "2026-09-28",
        "startTime": "10:00",
        "endTime": "10:50",
        "price": 280,
        "currency": "HKD",
        "qr": {
            "available": false,
            "verified": false
        },
        "review": {
            "allowed": false,
            "submitted": false
        }
    }
}

62.Cancel Appointment  post =>http://localhost:5000/api/v1/appointments/3c29cc67-d6a3-48cc-b290-700bb8921f5a/cancel

request :{
  "reason": "Schedule changed"
}

response :{
  "success": true,
  "statusCode": 200,
  "message": "Appointment cancelled successfully",
  "data": {
    "appointmentId": "1c862e2b-2063-45b6-b1ce-5934e3a791ae",
    "appointmentStatus": "CANCELLED",
    "refundStatus": "NOT_REQUIRED"
  }
}

63. Appointment Reschedule  post =>http://localhost:5000/api/v1/appointments/3c29cc67-d6a3-48cc-b290-700bb8921f5a/reschedule

request :{
  "date": "2026-09-28",
  "startTime": "14:00",
  "staffId": "f734927d-38d6-484a-a895-3c59465ed023"
}

response:{
  "success": true,
  "statusCode": 200,
  "message": "Appointment rescheduled successfully",
  "data": {
    "appointmentId": "a1e65c60-902e-4096-9821-ac083a324606",
    "date": "2026-09-28",
    "startTime": "14:00",
    "endTime": "14:50"
  }
}

64.Get Appointment Qr Code  get =>http://localhost:5000/api/v1/appointments/12cdb3e1-e0d6-4952-a8c3-b1eb99e63582/qr


response:{
  "success": true,
  "statusCode": 200,
  "message": "Appointment QR fetched successfully",
  "data": {
    "available": true,
    "qrValue": "reservation:..."
  }
}

65.Reservation Qr Code Verification(owner/manager/staff)  post =>http://localhost:5000/api/v1/appointments/verify-qr

request:{
  "qrToken": "d07acdaaba1ae4e284e4bb271585ee935375bced835aafa6e1958b58b5b96871",
  "branchId": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Reservation verified successfully",
    "data": {
        "appointmentId": "187df81f-87d7-4ba8-b905-213be44ed80c",
        "appointmentStatus": "CONFIRMED",
        "qrVerifiedAt": "2026-09-28T04:44:58.139Z",
        "verifiedBy": {
            "id": "8ab8e2d0-b5d8-47cc-b451-0f18cfc39c13",
            "name": "Salon Owner"
        }
    }
}

66.Create AppointMent Complete (owner/manager/staff) post =>http://localhost:5000/api/v1/appointments/187df81f-87d7-4ba8-b905-213be44ed80c/complete

request:{
  "notes": "Service completed successfully"
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Appointment completed successfully",
    "data": {
        "appointmentId": "187df81f-87d7-4ba8-b905-213be44ed80c",
        "appointmentStatus": "COMPLETED",
        "completedAt": "2026-09-28T04:46:04.177Z",
        "reviewEnabled": true
    }
}

67.Reservation Mark As No Show (owner/manager) post =>http://localhost:5000/api/v1/appointments/b43607a9-85f7-49ad-899d-8b5a5649cc1d/no-show

request:{
  "reason": "Customer did not attend"
}

response:{

    "success": true,

    "statusCode": 200,

    "message": "Appointment marked as no-show successfully",

    "data": {

        "appointmentId": "b43607a9-85f7-49ad-899d-8b5a5649cc1d",

        "appointmentStatus": "NO_SHOW"

    }

} 

68.Get Branch Appointments(owner/manager/staff) get =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/appointments?page=1&limit=20&date=2026-09-28&staffId=f734927d-38d6-484a-a895-3c59465ed023&bookingMethod=RESERVE_NOW&appointmentStatus=RESERVED&paymentStatus=UNPAID


response:{
    "success": true,
    "statusCode": 200,
    "message": "Branch appointments fetched successfully",
    "data": {
        "items": [
            {
                "id": "a1e65c60-902e-4096-9821-ac083a324606",
                "bookingMethod": "RESERVE_NOW",
                "appointmentStatus": "RESERVED",
                "paymentStatus": "UNPAID",
                "customer": {
                    "id": "15fb4319-0091-430e-9126-c8ced8122c99",
                    "name": "Saikat Updated",
                    "phone": "+85298887777"
                },
                "staff": {
                    "id": "f734927d-38d6-484a-a895-3c59465ed023",
                    "name": "Alex Wong"
                },
                "service": {
                    "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                    "name": "Premium Men's Haircut"
                },
                "package": null,
                "date": "2026-09-28",
                "startTime": "11:00",
                "endTime": "11:50",
                "durationMinutes": 50,
                "price": 280,
                "currency": "HKD"
            },
            {
                "id": "3cdb82ff-db35-4270-9006-4c7c4199b8a6",
                "bookingMethod": "RESERVE_NOW",
                "appointmentStatus": "RESERVED",
                "paymentStatus": "UNPAID",
                "customer": {
                    "id": "15fb4319-0091-430e-9126-c8ced8122c99",
                    "name": "Saikat Updated",
                    "phone": "+85298887777"
                },
                "staff": {
                    "id": "f734927d-38d6-484a-a895-3c59465ed023",
                    "name": "Alex Wong"
                },
                "service": {
                    "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                    "name": "Premium Men's Haircut"
                },
                "package": null,
                "date": "2026-09-28",
                "startTime": "14:00",
                "endTime": "14:50",
                "durationMinutes": 50,
                "price": 280,
                "currency": "HKD"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 2,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}


69.As a Owner get All Appointments (owner) get =>http://localhost:5000/api/v1/appointments

response:{
    "success": true,
    "statusCode": 200,
    "message": "Appointments fetched successfully",
    "data": {
        "items": [
           
            
            {
                "id": "5478c354-97b0-4514-845b-77f0a89d4c5a",
                "bookingMethod": "PAY_NOW",
                "appointmentStatus": "PENDING_PAYMENT",
                "paymentStatus": "PENDING",
                "branch": {
                    "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                    "name": "Mong Kok Central Branch"
                },
                "customer": {
                    "id": "85200c8d-fb01-44b1-a537-8c2e48a3347b",
                    "name": "david",
                    "phone": "+85291234563"
                },
                "staff": {
                    "id": "f734927d-38d6-484a-a895-3c59465ed023",
                    "name": "Alex Wong"
                },
                "service": {
                    "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                    "name": "Premium Men's Haircut"
                },
                "package": null,
                "date": "2026-09-28",
                "startTime": "10:00",
                "endTime": "10:50",
                "durationMinutes": 50,
                "price": 280,
                "currency": "HKD"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 21,
            "totalPages": 2,
            "hasNextPage": true,
            "hasPreviousPage": false
        }
    }
}


70.as a Staff Get My Appointment (staff) get =>http://localhost:5000/api/v1/staff/me/appointments?date=2026-09-28&page=1&limit=20

response:{
    "success": true,
    "statusCode": 200,
    "message": "Staff appointments fetched successfully",
    "data": {
        "items": [
           
           
            {
                "id": "20546e52-bda6-40b7-ad21-3885a93c007b",
                "bookingMethod": "PAY_NOW",
                "appointmentStatus": "PENDING_PAYMENT",
                "paymentStatus": "PENDING",
                "branch": {
                    "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                    "name": "Mong Kok Central Branch"
                },
                "customer": {
                    "id": "85200c8d-fb01-44b1-a537-8c2e48a3347b",
                    "name": "david",
                    "phone": "+85291234563"
                },
                "service": {
                    "id": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                    "name": "Premium Men's Haircut"
                },
                "package": null,
                "date": "2026-09-28",
                "startTime": "10:00",
                "endTime": "10:50",
                "durationMinutes": 50
            },
           
            
            
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 21,
            "totalPages": 2,
            "hasNextPage": true,
            "hasPreviousPage": false
        }
    }
}


71.Create Payment intent post =>http://localhost:5000/api/v1/payments/stripe/create-intent

request:
{
  "appointmentId": "ad048c12-2731-4d09-bb81-eb6598843260"
}

response:{
    "success": true,
    "statusCode": 201,
    "message": "Stripe PaymentIntent created successfully",
    "data": {
        "paymentId": "d3e7dc01-1b9d-4ae4-962d-9b9280dd43ae",
        "appointmentId": "ad048c12-2731-4d09-bb81-eb6598843260",
        "amount": 280,
        "currency": "HKD",
        "paymentStatus": "PENDING",
        "clientSecret": "pi_3UKWZ935Sl8k9TrM1NVF8vrZ_secret_LFy6ZdF3obHFrpVpqBZ77xBDW"
    }
}

72.Get Payment Details  get =>http://localhost:5000/api/v1/payments/1c36eabd-68c8-4e90-9e7d-b31447470ea8

response:{
    "success": true,
    "statusCode": 200,
    "message": "Payment fetched successfully",
    "data": {
        "id": "1c36eabd-68c8-4e90-9e7d-b31447470ea8",
        "amount": 280,
        "currency": "HKD",
        "paymentStatus": "PARTIALLY_REFUNDED",
        "provider": "STRIPE",
        "providerPaymentId": "pi_3UIjhB35Sl8k9TrM1Pbr5Waz",
        "appointmentId": "3c29cc67-d6a3-48cc-b290-700bb8921f5a"
    }
}

73.GEt My All Payments  get =>http://localhost:5000/api/v1/payments/my

response:{
    "success": true,
    "statusCode": 200,
    "message": "Payments fetched successfully",
    "data": {
        "items": [
            {
                "id": "d3e7dc01-1b9d-4ae4-962d-9b9280dd43ae",
                "amount": 280,
                "currency": "HKD",
                "paymentStatus": "PENDING",
                "provider": "STRIPE",
                "providerPaymentId": "pi_3UKWZ935Sl8k9TrM1NVF8vrZ",
                "appointmentId": "ad048c12-2731-4d09-bb81-eb6598843260"
            },
           
            {
                "id": "7a18745e-76cc-4039-885b-402086bd50fd",
                "amount": 280,
                "currency": "HKD",
                "paymentStatus": "PENDING",
                "provider": "STRIPE",
                "providerPaymentId": "pi_3UIiSt35Sl8k9TrM0wvCFi7E",
                "appointmentId": "a5f2002a-33b9-4467-a619-f08ddc7a90e8"
            },
            {
                "id": "bc68f61f-6f4a-4faa-a37b-56a05ab92031",
                "amount": 280,
                "currency": "HKD",
                "paymentStatus": "PENDING",
                "provider": "STRIPE",
                "providerPaymentId": "pi_3UIhOv35Sl8k9TrM1FVNJt6r",
                "appointmentId": "23a0ce40-8228-4f5e-9410-a794196cc67d"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 10,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}


74.Create Refund As a Brand Owner (owner) post =>http://localhost:5000/api/v1/payments/1c36eabd-68c8-4e90-9e7d-b31447470ea8/refund

request:{
  "amount": 100,
  "reason": "CUSTOMER_REQUEST"
}
response:{

    "success": true,

    "statusCode": 200,

    "message": "Payment refunded successfully",

    "data": {

        "paymentId": "1c36eabd-68c8-4e90-9e7d-b31447470ea8",

        "refundId": "c046dc2a-e745-4a4f-bae5-9d91c67f5141",

        "refundStatus": "SUCCEEDED",

        "amount": 100

    }

} 

75.Get Wallet  get =>http://localhost:5000/api/v1/wallet

response:{
    "success": true,
    "statusCode": 200,
    "message": "Wallet fetched successfully",
    "data": {
        "paidBalance": 2440,
        "bonusBalance": 250,
        "totalBalance": 2690,
        "currency": "HKD"
    }
}

76.Get Wallet Transaction  get =>http://localhost:5000/api/v1/wallet/transactions?page=1&limit=20

response:{
    "success": true,
    "statusCode": 200,
    "message": "Wallet transactions fetched successfully",
    "data": {
        "items": [
            {
                "id": "d4cedb63-eabf-4228-87f5-dd415803674e",
                "type": "APPOINTMENT_PAYMENT",
                "balanceType": "PAID",
                "amount": -280,
                "createdAt": "2026-09-24T03:59:34.894Z"
            },
            
            {
                "id": "bd5ea2be-3a27-452b-a541-49c8cc25ad57",
                "type": "TOP_UP",
                "balanceType": "PAID",
                "amount": 1000,
                "createdAt": "2026-09-23T08:48:23.925Z"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 5,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}

77.Create Wallet Topup  post =>http://localhost:5000/api/v1/wallet/topups

request:{
  "amount": 2000
}

response:{
    "success": true,
    "statusCode": 201,
    "message": "Wallet top-up initiated successfully",
    "data": {
        "topupId": "0cb0e5bf-1f58-4b4e-93eb-b672e339dc7f",
        "amount": 2000,
        "potentialBonus": 250,
        "stripeClientSecret": "pi_3UKWcw35Sl8k9TrM08zs99Xx_secret_t4Dt7WLzgxIuZQ1YNboWiO1tm"
    }
}

78.Pay With Wallet post =>http://localhost:5000/api/v1/appointments/ad423aac-979f-4c92-9c91-03d231b61a17/pay-with-wallet

request:{
  "useBonus": true
}
response:{
  "paymentStatus": "PAID",
  "paidBalanceUsed": 200,
  "bonusBalanceUsed": 50,
  "remainingPaidBalance": 800,
  "remainingBonusBalance": 150
}

79.Create Promotion (owner) post =>http://localhost:5000/api/v1/promotions

request:{
  "name": "Top Up 1000 Get 200",
  "minimumTopup": 1000,
  "bonusAmount": 200,
  "startAt": "2026-10-01T00:00:00+08:00",
  "endAt": "2026-10-31T23:59:59+08:00",
  "branchIds": [],
  "serviceIds": [],
  "packageIds": [],
  "status": "ACTIVE"
}

response:{
    "success": true,
    "statusCode": 201,
    "message": "Promotion created successfully",
    "data": {
        "id": "1cf0d668-51a5-4853-b6ad-ef2adc7bfc6a",
        "name": "Top Up 1000 Get 200",
        "status": "ACTIVE"
    }
}

80.GEt Promotion  get =>http://localhost:5000/api/v1/promotions

response:{
    "success": true,
    "statusCode": 200,
    "message": "Promotions fetched successfully",
    "data": {
        "items": [
            {
                "id": "1cf0d668-51a5-4853-b6ad-ef2adc7bfc6a",
                "name": "Top Up 1000 Get 200",
                "minimumTopup": 1000,
                "bonusAmount": 200,
                "startAt": "2026-09-30T16:00:00.000Z",
                "endAt": "2026-10-31T15:59:59.000Z",
                "status": "ACTIVE",
                "branchIds": [],
                "serviceIds": [],
                "packageIds": []
            },
            {
                "id": "bcb06725-d3b6-4473-9bd1-ff688ff29ff9",
                "name": "Top Up 1000 Get 200",
                "minimumTopup": 1000,
                "bonusAmount": 250,
                "startAt": "2026-09-23T16:00:00.000Z",
                "endAt": "2026-10-31T15:59:59.000Z",
                "status": "ACTIVE",
                "branchIds": [],
                "serviceIds": [],
                "packageIds": []
            }
        ]
    }
}

81.Get Single Promotion  get =>http://localhost:5000/api/v1/promotions/bcb06725-d3b6-4473-9bd1-ff688ff29ff9

response:{
    "success": true,
    "statusCode": 200,
    "message": "Promotion fetched successfully",
    "data": {
        "id": "bcb06725-d3b6-4473-9bd1-ff688ff29ff9",
        "name": "Top Up 1000 Get 200",
        "minimumTopup": 1000,
        "bonusAmount": 250,
        "startAt": "2026-09-23T16:00:00.000Z",
        "endAt": "2026-10-31T15:59:59.000Z",
        "status": "ACTIVE",
        "branchIds": [],
        "serviceIds": [],
        "packageIds": []
    }
}

82.Update Promotion (owner) patch =>http://localhost:5000/api/v1/promotions/bcb06725-d3b6-4473-9bd1-ff688ff29ff9

request:{
  "startAt": "2026-09-24T00:00:00+08:00",
  "branchIds": [],
  "serviceIds": [],
  "packageIds": []
}

response:{
    "success": true,
    "statusCode": 200,
    "message": "Promotion updated successfully",
    "data": {
        "id": "bcb06725-d3b6-4473-9bd1-ff688ff29ff9",
        "name": "Top Up 1000 Get 200",
        "minimumTopup": 1000,
        "bonusAmount": 250,
        "startAt": "2026-09-23T16:00:00.000Z",
        "endAt": "2026-10-31T15:59:59.000Z",
        "branchIds": [],
        "serviceIds": [],
        "packageIds": []
    }
}

83.Update Promotion Status (owner) patch =>http://localhost:5000/api/v1/promotions/bcb06725-d3b6-4473-9bd1-ff688ff29ff9/status

request :{
  "status": "ACTIVE"
}


84.Create Review  post =>http://localhost:5000/api/v1/appointments/12cdb3e1-e0d6-4952-a8c3-b1eb99e63582/reviews

request:{
  "rating": 5,
  "comment": "Excellent service.",
  "imageObjectKeys": []
}

response:{

    "success": true,

    "statusCode": 201,

    "message": "Review created successfully",

    "data": {

        "id": "ec9ae45c-84a4-43b9-9a6f-8d8afe146e19",

        "rating": 5,

        "comment": "Excellent service.",

        "images": [],

        "moderationStatus": "VISIBLE"

    }

}

85.Get branch Review  () get =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/reviews?page=1&limit=20&rating=5

response:{
    "success": true,
    "statusCode": 200,
    "message": "Branch reviews fetched successfully",
    "data": {
        "items": [
            {
                "id": "d438bda5-c797-4849-b43b-71664e660ecc",
                "rating": 5,
                "comment": "Excellent service.",
                "customer": {
                    "id": "85200c8d-fb01-44b1-a537-8c2e48a3347b",
                    "name": "david"
                },
                "staff": {
                    "id": "f734927d-38d6-484a-a895-3c59465ed023",
                    "name": "Alex Wong"
                },
                "images": [],
                "createdAt": "2026-09-24T02:53:36.880Z"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 1,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}

86.Get Staff review() get =>http://localhost:5000/api/v1/staff/f734927d-38d6-484a-a895-3c59465ed023/reviews?page=1&limit=20&rating=5

response:{
    "success": true,
    "statusCode": 200,
    "message": "Staff reviews fetched successfully",
    "data": {
        "items": [
            {
                "id": "d438bda5-c797-4849-b43b-71664e660ecc",
                "rating": 5,
                "comment": "Excellent service.",
                "customer": {
                    "id": "85200c8d-fb01-44b1-a537-8c2e48a3347b",
                    "name": "david"
                },
                "branch": {
                    "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                    "name": "Mong Kok Central Branch"
                },
                "images": [],
                "createdAt": "2026-09-24T02:53:36.880Z"
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 1,
            "totalPages": 1,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}

87.Update Review ()  patch =>http://localhost:5000/api/v1/reviews/ec9ae45c-84a4-43b9-9a6f-8d8afe146e19

request:{
  "rating": 4,
  "comment": "Updated review"
}
response:{

    "success": true,

    "statusCode": 200,

    "message": "Review updated successfully",

    "data": {

        "id": "ec9ae45c-84a4-43b9-9a6f-8d8afe146e19",

        "rating": 4,

        "comment": "Updated review",

        "images": []

    }

}
88.Delete review  delete =>http://localhost:5000/api/v1/reviews/ec9ae45c-84a4-43b9-9a6f-8d8afe146e19

89.Update Review Moderation  patch =>http://localhost:5000/api/v1/reviews/d438bda5-c797-4849-b43b-71664e660ecc/moderation

request:{
  "moderationStatus": "VISIBLE",
  "reason": "appropriate content"
}

response:{
  "success": true,
  "statusCode": 200,
  "message": "Review moderation updated successfully",
  "data": {
    "id": "d438bda5-c797-4849-b43b-71664e660ecc",
    "moderationStatus": "VISIBLE"
  }
}

90.Get All Notification  get =>http://localhost:5000/api/v1/notifications?page=1&limit=20&unreadOnly=true

response:{
    "success": true,
    "statusCode": 200,
    "message": "Notifications fetched successfully",
    "data": {
        "items": [],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 0,
            "totalPages": 0,
            "hasNextPage": false,
            "hasPreviousPage": false
        }
    }
}

91.Mark Notification as Read  patch =>http://localhost:5000/api/v1/notifications/2e9e5241-452e-4e53-9b36-b56f00b7ee5b/read

response:{
    "success": true,
    "statusCode": 200,
    "message": "Notification marked as read successfully",
    "data": {
        "id": "2e9e5241-452e-4e53-9b36-b56f00b7ee5b",
        "isRead": true
    }
}

92.Mark All Notification as read  patch =>http://localhost:5000/api/v1/notifications/read-all

response:{
    "success": true,
    "statusCode": 200,
    "message": "All notifications marked as read",
    "data": null
}

93.Create Branch Manager as (owner) post =>http://localhost:5000/api/v1/branch-managers

request:{
  "name": "David Lees",
  "email": "david2.manager@salon.hk",
  "phone": "+85298887761",
  "branchIds": [
    "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
  ]
}

response:{
    "success": true,
    "statusCode": 201,
    "message": "Branch manager created successfully",
    "data": {
        "id": "e1579022-20f9-4216-9ee9-b946edf815e1",
        "name": "David Lees",
        "branchIds": [
            "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
        ],
        "status": "ACTIVE",
        "temporaryPassword": "PAhQvnFlnclHjghr"
    }
}

94.GEt All Branch MAnager  get =>http://localhost:5000/api/v1/branch-managers

response:{
    "success": true,
    "statusCode": 200,
    "message": "Branch managers fetched successfully",
    "data": {
        "items": [
            {
                "id": "e1579022-20f9-4216-9ee9-b946edf815e1",
                "name": "David Lees",
                "email": "david2.manager@salon.hk",
                "phone": "+85298887761",
                "branchIds": [
                    "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
                ],
                "status": "ACTIVE"
            },
            {
                "id": "d705ee16-b268-4eda-85ab-798c595ab472",
                "name": "David Lee",
                "email": "david.manager@salon.hk",
                "phone": "+85298887766",
                "branchIds": [
                    "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
                ],
                "status": "INACTIVE"
            }
        ]
    }
}

95.Get Single Branch Manager  get =>http://localhost:5000/api/v1/branch-managers/d705ee16-b268-4eda-85ab-798c595ab472

response :{
    "success": true,
    "statusCode": 200,
    "message": "Branch manager fetched successfully",
    "data": {
        "id": "d705ee16-b268-4eda-85ab-798c595ab472",
        "name": "David Lee",
        "email": "david.manager@salon.hk",
        "phone": "+85298887766",
        "branchIds": [
            "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
        ],
        "branches": [
            {
                "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                "name": "Mong Kok Central Branch"
            }
        ],
        "status": "INACTIVE"
    }
}

96.Put/Assign Branch Manager (owner) Put =>http://localhost:5000/api/v1/branch-managers/d705ee16-b268-4eda-85ab-798c595ab472/branches

request:{
  "branchIds": [
    "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
  ]
}
response:{
    "success": true,
    "statusCode": 200,
    "message": "Branch manager branches updated successfully",
    "data": {
        "managerId": "d705ee16-b268-4eda-85ab-798c595ab472",
        "branchIds": [
            "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989"
        ]
    }
}

97.Update Branch Manager Status (owner) patch =>http://localhost:5000/api/v1/branch-managers/d705ee16-b268-4eda-85ab-798c595ab472/status

request:{
  "status": "INACTIVE"
}


98.Get All User As (owner)  get =>http://localhost:5000/api/v1/admin/users

response:{
    "success": true,
    "statusCode": 200,
    "message": "Users fetched successfully",
    "data": {
        "items": [
            {
                "id": "e1579022-20f9-4216-9ee9-b946edf815e1",
                "name": "David Lees",
                "email": "david2.manager@salon.hk",
                "phone": "+85298887761",
                "role": "BRANCH_MANAGER",
                "status": "ACTIVE"
            },
            {
                "id": "d18ba928-92bd-4993-b4f6-bbf9b68e74ca",
                "name": "Saikat",
                "email": "saikatali5711@gmail.com",
                "phone": "+85291234560",
                "role": "STAFF",
                "status": "ACTIVE"
            },
           
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 9,
            "totalPages": 1
        }
    }
}
99.Get Single User info as (owner) get =>http://localhost:5000/api/v1/admin/users/85200c8d-fb01-44b1-a537-8c2e48a3347b

response:{
    "success": true,
    "statusCode": 200,
    "message": "User fetched successfully",
    "data": {
        "id": "85200c8d-fb01-44b1-a537-8c2e48a3347b",
        "name": "david",
        "email": "david571@gmail.com",
        "phone": "+85291234563",
        "role": "CUSTOMER",
        "status": "ACTIVE",
        "avatarUrl": null,
        "createdAt": "2026-09-22T07:36:13.375Z",
        "updatedAt": "2026-09-28T04:33:52.275Z",
        "stats": {
            "totalAppointments": 12,
            "completedAppointments": 1,
            "cancelledAppointments": 0,
            "noShowAppointments": 1,
            "totalReviews": 1,
            "totalGroupPurchases": 0
        },
        "wallet": {
            "paidBalance": 2440,
            "bonusBalance": 250,
            "totalBalance": 2690,
            "currency": "HKD"
        },
        "roleDetails": null
    }
}

100.Update User Status as (owner) patch =>http://localhost:5000/api/v1/admin/users/85200c8d-fb01-44b1-a537-8c2e48a3347b/status

request :{
  "status": "ACTIVE"
}
response:{
    "success": true,
    "statusCode": 200,
    "message": "User status updated successfully",
    "data": {
        "id": "85200c8d-fb01-44b1-a537-8c2e48a3347b",
        "status": "ACTIVE"
    }
}

101.GEt full brand dashboard data As (owner) get =>http://localhost:5000/api/v1/dashboard?from=2026-09-01&to=2026-09-30

response:{
    "success": true,
    "statusCode": 200,
    "message": "Dashboard fetched successfully",
    "data": {
        "period": {
            "from": "2026-09-01",
            "to": "2026-09-30"
        },
        "overview": {
            "totalBranches": 2,
            "totalStaff": 3,
            "totalCustomers": 3,
            "newCustomers": 3
        },
        "appointments": {
            "total": 22,
            "payNow": 15,
            "reserveNow": 7,
            "pendingPayment": 12,
            "reserved": 2,
            "confirmed": 3,
            "completed": 2,
            "completedReserveNow": 2,
            "cancelled": 2,
            "noShow": 1,
            "expired": 0
        },
        "kpis": {
            "completionRate": 9.09,
            "cancellationRate": 9.09,
            "noShowRate": 4.55,
            "reserveConversionRate": 28.57,
            "averageBookingValue": 280,
            "completedServiceValue": 560
        },
        "payments": {
            "stripeTotal": 280,
            "walletPaidTotal": 560,
            "walletBonusUsed": 0,
            "grossCollected": 840,
            "refundTotal": 100,
            "netCollected": 740,
            "currency": "HKD"
        },
        "wallet": {
            "topupTotal": 3000,
            "bonusIssued": 250,
            "currency": "HKD"
        },
        "groupPurchase": {
            "activePackages": 2,
            "totalSold": 0,
            "salesAmount": 0,
            "currency": "HKD"
        }
    }
}


102.Get branch dashboard data as (owner) get =>http://localhost:5000/api/v1/branches/a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989/dashboard?from=2026-09-01&to=2026-09-30

response:{
    "success": true,
    "statusCode": 200,
    "message": "Branch dashboard fetched successfully",
    "data": {
        "period": {
            "from": "2026-09-01",
            "to": "2026-09-30"
        },
        "branch": {
            "id": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
            "name": "Mong Kok Central Branch",
            "status": "ACTIVE"
        },
        "overview": {
            "staffCount": 3,
            "totalAppointments": 22
        },
        "appointments": {
            "total": 22,
            "payNow": 15,
            "reserveNow": 7,
            "pendingPayment": 12,
            "reserved": 2,
            "confirmed": 3,
            "completed": 2,
            "completedReserveNow": 2,
            "cancelled": 2,
            "noShow": 1,
            "expired": 0
        },
        "kpis": {
            "completionRate": 9.09,
            "cancellationRate": 9.09,
            "noShowRate": 4.55,
            "reserveConversionRate": 28.57,
            "averageBookingValue": 280,
            "completedServiceValue": 560
        },
        "payments": {
            "stripeTotal": 280,
            "walletPaidTotal": 560,
            "walletBonusUsed": 0,
            "grossCollected": 840,
            "refundTotal": 100,
            "netCollected": 740,
            "currency": "HKD"
        }
    }
}

103.Get branch report as (owner) get =>http://localhost:5000/api/v1/reports/branches?from=2026-09-01&to=2026-09-30

response:{
    "success": true,
    "statusCode": 200,
    "message": "Branch report fetched successfully",
    "data": {
        "period": {
            "from": "2026-09-01",
            "to": "2026-09-30"
        },
        "items": [
            {
                "branchId": "ce301969-5d02-4a50-8378-90137e0744bd",
                "branchName": "Mong Kok Branch",
                "branchStatus": "ACTIVE",
                "staffCount": 0,
                "totalAppointments": 0,
                "payNow": 0,
                "reserveNow": 0,
                "confirmed": 0,
                "completed": 0,
                "cancelled": 0,
                "noShow": 0,
                "reserveCompleted": 0,
                "reserveNoShow": 0,
                "rates": {
                    "completionRate": 0,
                    "cancellationRate": 0,
                    "noShowRate": 0,
                    "reserveConversionRate": 0,
                    "reserveNoShowRate": 0
                },
                "completedServiceValue": 0,
                "currency": "HKD"
            },
            {
                "branchId": "a2152e1b-5a4d-4ec1-abe5-e3ae7d4f9989",
                "branchName": "Mong Kok Central Branch",
                "branchStatus": "ACTIVE",
                "staffCount": 3,
                "totalAppointments": 22,
                "payNow": 15,
                "reserveNow": 7,
                "confirmed": 3,
                "completed": 2,
                "cancelled": 2,
                "noShow": 1,
                "reserveCompleted": 2,
                "reserveNoShow": 1,
                "rates": {
                    "completionRate": 9.09,
                    "cancellationRate": 9.09,
                    "noShowRate": 4.55,
                    "reserveConversionRate": 28.57,
                    "reserveNoShowRate": 14.29
                },
                "completedServiceValue": 560,
                "currency": "HKD"
            }
        ]
    }
}

104.Get Booking conversion report as (owner)  get =>http://localhost:5000/api/v1/reports/booking-conversion?from=2026-09-01&to=2026-09-30

response:{
    "success": true,
    "statusCode": 200,
    "message": "Booking conversion report fetched successfully",
    "data": {
        "period": {
            "from": "2026-09-01",
            "to": "2026-09-30"
        },
        "filters": {
            "branchId": null,
            "staffId": null,
            "serviceId": null,
            "packageId": null
        },
        "overall": {
            "totalAppointments": 22,
            "eligibleAppointments": 5,
            "completedAppointments": 2,
            "cancelledAppointments": 2,
            "noShowAppointments": 1,
            "pendingPaymentAppointments": 12,
            "reservedAppointments": 2,
            "confirmedAppointments": 3,
            "expiredAppointments": 0,
            "conversionRate": 40
        },
        "payNow": {
            "total": 15,
            "resolved": 0,
            "completed": 0,
            "cancelled": 0,
            "noShow": 0,
            "conversionRate": 0,
            "noShowRate": 0
        },
        "reserveNow": {
            "total": 7,
            "resolved": 5,
            "completed": 2,
            "cancelled": 2,
            "noShow": 1,
            "stillReserved": 2,
            "confirmed": 0,
            "reserveConversionRate": 28.57,
            "reserveCancellationRate": 28.57,
            "reserveNoShowRate": 14.29,
            "resolvedConversionRate": 40,
            "resolvedNoShowRate": 20
        }
    }
}

105. Get Service Report as (owner) get =>http://localhost:5000/api/v1/reports/services

response :{
    "success": true,
    "statusCode": 200,
    "message": "Service report fetched successfully",
    "data": {
        "items": [
            {
                "serviceId": "ebe057d9-6a8b-4c52-8580-4cb9e5e7e98b",
                "serviceName": "Premium Men's Haircut",
                "bookingCount": 22,
                "completedCount": 2,
                "cancelledCount": 2,
                "noShowCount": 1,
                "revenue": 560
            }
        ]
    }
}

106.Get Packages Report as (owner)  get =>http://localhost:5000/api/v1/reports/packages

response:{
  "success": true,
  "statusCode": 200,
  "message": "Package report fetched successfully",
  "data": {
    "items": [
      {
        "packageId": "eba057d9-6a8a-4c52-8580-4cb9e5e7e98a",
        "packageName": "Wash + Cut + Styling",
        "bookingCount": 5,
        "completedCount": 3,
        "cancelledCount": 1,
        "noShowCount": 0,
        "revenue": 1500
      }
    ]
  }
}

107.GEt Group Purchase Report (owner)  get =>http://localhost:5000/api/v1/reports/group-purchases

response:{
    "success": true,
    "statusCode": 200,
    "message": "Group purchase report fetched successfully",
    "data": {
        "items": [
            {
                "packageId": "8c2e4488-e81b-4b67-babb-a94ee13850d4",
                "name": "Summer Wash + Cut Deal",
                "capacity": 100,
                "soldQuantity": 0,
                "remainingQuantity": 100,
                "uniqueCustomers": 0,
                "salesAmount": 0,
                "listingStatus": "LISTED",
                "soldOut": false
            },
            {
                "packageId": "270106ec-de0a-4668-b4be-ca542c06987c",
                "name": "Summer Wash + Cut Deal Plus",
                "capacity": 120,
                "soldQuantity": 0,
                "remainingQuantity": 120,
                "uniqueCustomers": 0,
                "salesAmount": 0,
                "listingStatus": "LISTED",
                "soldOut": false
            }
        ]
    }
}

108.Get Staff Report as(owner) get =>http://localhost:5000/api/v1/reports/staff

response:{
    "success": true,
    "statusCode": 200,
    "message": "Staff report fetched successfully",
    "data": {
        "items": [
            {
                "staffId": "f734927d-38d6-484a-a895-3c59465ed023",
                "name": "Alex Wong",
                "assignedAppointments": 22,
                "completedAppointments": 2,
                "cancelled": 2,
                "noShow": 1,
                "averageRating": 5
            },
            {
                "staffId": "d11ecf89-7c6c-4ac9-a164-248df9636d04",
                "name": "James Wong",
                "assignedAppointments": 0,
                "completedAppointments": 0,
                "cancelled": 0,
                "noShow": 0,
                "averageRating": 0
            },
            {
                "staffId": "da326fb7-9149-480c-b965-d88a556945ba",
                "name": "Saikat",
                "assignedAppointments": 0,
                "completedAppointments": 0,
                "cancelled": 0,
                "noShow": 0,
                "averageRating": 0
            }
        ]
    }
}

