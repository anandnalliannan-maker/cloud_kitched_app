import 'package:cloud_firestore/cloud_firestore.dart';

class ProfileService {
  ProfileService({FirebaseFirestore? firestore})
      : _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _firestore;

  DocumentReference<Map<String, dynamic>> userRef(String uid) {
    return _firestore.collection('users').doc(uid);
  }

  Future<void> updateCustomerProfile({
    required String uid,
    required String name,
    required String phone,
    required String flat,
    required String apartment,
    required String street,
    required String area,
    double? latitude,
    double? longitude,
  }) {
    final data = <String, dynamic>{
      'name': name,
      'phone': phone,
      'address': {
        'flat': flat,
        'apartment': apartment,
        'street': street,
        'area': area,
      },
      'profileCompleted': true,
      'updatedAt': FieldValue.serverTimestamp(),
    };

    if (latitude != null && longitude != null) {
      data['location'] = {
        'lat': latitude,
        'lng': longitude,
      };
    }

    return userRef(uid).update(data);
  }
}
