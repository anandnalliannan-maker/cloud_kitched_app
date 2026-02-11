import 'package:cloud_firestore/cloud_firestore.dart';

class AddressService {
  AddressService({FirebaseFirestore? firestore})
      : _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _firestore;

  CollectionReference<Map<String, dynamic>> addressesRef(String uid) {
    return _firestore.collection('users').doc(uid).collection('addresses');
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchAddresses(String uid) {
    return addressesRef(uid).orderBy('createdAt', descending: true).snapshots();
  }

  Future<int> addressCount(String uid) async {
    final snapshot = await addressesRef(uid).get();
    return snapshot.docs.length;
  }

  Future<void> addAddress({
    required String uid,
    required String name,
    required String phone,
    required String flat,
    required String apartment,
    required String street,
    required String area,
    double? latitude,
    double? longitude,
  }) async {
    final count = await addressCount(uid);
    if (count >= 5) {
      throw StateError('You can save up to 5 addresses');
    }

    final data = <String, dynamic>{
      'name': name,
      'phone': phone,
      'flat': flat,
      'apartment': apartment,
      'street': street,
      'area': area,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    };

    if (latitude != null && longitude != null) {
      data['location'] = {
        'lat': latitude,
        'lng': longitude,
      };
    }

    final ref = await addressesRef(uid).add(data);
    if (count == 0) {
      await _firestore.collection('users').doc(uid).update({
        'defaultAddressId': ref.id,
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }
  }

  Future<void> updateAddress({
    required String uid,
    required String addressId,
    required String name,
    required String flat,
    required String apartment,
    required String street,
    required String area,
    double? latitude,
    double? longitude,
  }) async {
    final data = <String, dynamic>{
      'name': name,
      'flat': flat,
      'apartment': apartment,
      'street': street,
      'area': area,
      'updatedAt': FieldValue.serverTimestamp(),
    };
    if (latitude != null && longitude != null) {
      data['location'] = {
        'lat': latitude,
        'lng': longitude,
      };
    }
    await addressesRef(uid).doc(addressId).update(data);
  }

  Future<void> deleteAddress({
    required String uid,
    required String addressId,
  }) async {
    await addressesRef(uid).doc(addressId).delete();
    final defaultId = await getDefaultAddressId(uid);
    if (defaultId == addressId) {
      final remaining = await addressesRef(uid).limit(1).get();
      await _firestore.collection('users').doc(uid).update({
        'defaultAddressId':
            remaining.docs.isEmpty ? FieldValue.delete() : remaining.docs.first.id,
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }
  }

  Future<void> setDefaultAddress({
    required String uid,
    required String addressId,
  }) {
    return _firestore.collection('users').doc(uid).update({
      'defaultAddressId': addressId,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<String?> getDefaultAddressId(String uid) async {
    final snap = await _firestore.collection('users').doc(uid).get();
    final data = snap.data();
    if (data == null) return null;
    final id = data['defaultAddressId'];
    return id is String && id.isNotEmpty ? id : null;
  }
}
