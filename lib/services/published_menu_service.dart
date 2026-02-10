import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class PublishedMenuService {
  PublishedMenuService({FirebaseAuth? auth, FirebaseFirestore? firestore})
      : _auth = auth ?? FirebaseAuth.instance,
        _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;

  CollectionReference<Map<String, dynamic>> get _menusRef =>
      _firestore.collection('published_menus');

  Stream<QuerySnapshot<Map<String, dynamic>>> watchPublishedMenus() {
    return _menusRef.orderBy('date').snapshots();
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchMenuItems(String menuId) {
    return _menusRef.doc(menuId).collection('items').snapshots();
  }

  Future<void> publishMenu({
    required DateTime date,
    required String meal,
    required List<Map<String, dynamic>> items,
  }) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw StateError('User not signed in');
    }

    final menuRef = _menusRef.doc();
    final batch = _firestore.batch();

    batch.set(menuRef, {
      'date': Timestamp.fromDate(DateTime(date.year, date.month, date.day)),
      'meal': meal,
      'mealOrder': _mealOrder(meal),
      'createdAt': FieldValue.serverTimestamp(),
      'createdBy': user.uid,
    });

    for (final item in items) {
      final itemRef = menuRef.collection('items').doc(item['id'] as String);
      batch.set(itemRef, {
        'name': item['name'],
        'price': item['price'],
        'qty': item['qty'],
      });
    }

    await batch.commit();
  }

  int _mealOrder(String meal) {
    switch (meal) {
      case 'breakfast':
        return 1;
      case 'lunch':
        return 2;
      case 'snacks':
        return 3;
      case 'dinner':
        return 4;
      default:
        return 99;
    }
  }
}
